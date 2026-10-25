# FootballOS shared contracts (v0.1, 2026-10-25)

Authoritative source: `packages/contracts` (zod schemas + inferred TypeScript types).
This document is the written specification the first version of that package is
transcribed from. When the package and this document disagree after the package exists,
**the package wins** and this document is updated by the contracts owner.

Owner of this surface: Backend / Team Platform Engineer (B). Every other agent proposes
changes through the lead; nobody else edits `packages/contracts`.

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Identifiers | `id: string`, UUID v4 (`crypto.randomUUID()`), never reused. Foreign keys are `<entity>Id`. |
| Timestamps | ISO 8601 UTC strings with millisecond precision (`2026-10-25T16:04:12.345Z`). Field names end in `At`: `createdAt`, `updatedAt`, `approvedAt`. Video times are **seconds from the start of the original uploaded file** as `number` (float), field names end in `Sec`: `startSec`, `endSec`, `atSec`. Never store frame numbers without the fps they were computed from. |
| Unknown / null | `null` means "not established / not visible / not provided". Never substitute a default. Labels carry `value: T \| null` plus a `status`. Optional request fields are omitted, not `null`. |
| Versioning | Mutable records carry `version: number` (starts at 1). Writes send `expectedVersion`; mismatch returns `409 conflict`. Reads return the current `version`. |
| Soft delete | Records that must stay auditable (plans, labels, playbook versions, recommendations) are never hard-deleted; they get `deletedAt` or a terminal state. Media files may be hard-deleted by an explicit retention action, which writes an audit event. |
| Pagination | `?limit=50&cursor=<opaque>`; response `{ items, nextCursor: string \| null }`. Default limit 50, max 200. |
| Money / cost | USD as `number` with up to 6 decimals in `costUsd`; token counts as integers. |
| Enum spelling | `snake_case` string literals. |
| Environment label | Every record set belongs to a `Team`; every `Team` has `environmentKind: 'demo' \| 'research' \| 'production'`. Demo data lives only in demo teams. UI shows the label. |

## 2. Error envelope

```json
{ "error": { "code": "conflict", "message": "Plan version 4 expected, current is 5", "details": { "currentVersion": 5 } } }
```

Codes and HTTP status:

| code | status | when |
| --- | --- | --- |
| `validation_error` | 400 | zod failure; `details.issues` lists zod issues |
| `unauthorized` | 401 | no/invalid session; MFA required but not completed (`details.mfaRequired: true`) |
| `forbidden` | 403 | authenticated but not permitted (wrong team, role, unit) |
| `not_found` | 404 | record missing **or** not visible to this team (never reveal existence across teams) |
| `conflict` | 409 | version mismatch, duplicate upload (`details.existingAssetId`), state transition not allowed |
| `payload_too_large` | 413 | upload or import above configured limits |
| `rate_limited` | 429 | `details.retryAfterSec` |
| `provider_unavailable` | 503 | model/storage provider failed; `details.retryable: boolean` |
| `internal` | 500 | sanitized; never echoes stack traces or uploaded content |

## 3. Auth and authorization

- Invite-only. `Invite { id, teamId, email, role, unit, expiresAt, acceptedAt, createdBy }`.
- `User { id, email, displayName, passwordHash (never serialized), mfaEnabled, createdAt }`.
- `Session { id, userId, createdAt, expiresAt, lastSeenAt, mfaVerified, ip (hashed), userAgent (truncated) }` as httpOnly, `SameSite=Lax`, `Secure` cookie `fos_session`. Idle timeout 12 h, absolute 30 d.
- MFA: TOTP (RFC 6238) with 10 single-use recovery codes. Required for `head_coach` and `coordinator`; recommended for all.
- `StaffMembership { id, teamId, userId, role, units[], title, active, createdAt }`.
- Roles: `head_coach`, `coordinator`, `position_coach`, `analyst`, `viewer`.
- Units: `offense`, `defense`, `special_teams`.

Rules (enforced server-side on every route, including media byte ranges and exports):

| Action | Who |
| --- | --- |
| View team records, comment | any active membership |
| Upload film, correct labels | `head_coach`, `coordinator`, `position_coach`, `analyst` |
| Edit a unit's draft plan | `head_coach`; `coordinator`/`position_coach` whose `units` contains the unit |
| Approve a unit plan | `coordinator` of that unit; `head_coach` (recorded as `override: true`) |
| Approve playbook extraction / roster edits | `head_coach`, `coordinator` of the unit |
| Manage staff, invites, retention, settings | `head_coach` |
| Share link creation | anyone who can view the shared record; links are team-scoped and expire |

Every approval, override, share, deletion, invite and role change writes `AuditEvent
{ id, teamId, actorUserId, action, targetType, targetId, at, details }`. Audit rows are
append-only.

## 4. Team, season, schedule

```ts
Team { id, name, shortName, level: 'high_school'|'college'|'other', environmentKind, timezone, createdAt }
Season { id, teamId, label: '2026', startsOn: 'YYYY-MM-DD', endsOn, isCurrent }
Opponent { id, teamId, name, shortName, notes }
ScheduledGame {
  id, teamId, seasonId, week: number|null, kind: 'regular'|'bye'|'scrimmage'|'playoff'|'other',
  opponentId: string|null, location: 'home'|'away'|'neutral'|null,
  scheduledAt: string|null, status: 'scheduled'|'rescheduled'|'postponed'|'canceled'|'final',
  result: { ourScore: number, theirScore: number, outcome: 'win'|'loss'|'tie' } | null,
  notes, version, createdAt, updatedAt
}
GameWorkspace { id, gameId, teamId }  // 1:1 with ScheduledGame; stable id; all film, scouting, plans hang off gameId, never off the date
ScheduleImport { id, teamId, seasonId, filename, status: 'previewed'|'applied'|'discarded', mapping: Record<string,string>, rowCount, errors: ImportRowError[], createdAt }
```

Season record = count of `status:'final'` games by `result.outcome`; bye/canceled excluded.
Computed in application code, never stored.

## 5. Media, processing jobs, segments

```ts
MediaAsset {
  id, teamId, gameId, uploadedBy, kind: 'game_film'|'clip'|'document'|'image',
  originalFilename, byteSize, sha256, mimeType, durationSec: number|null, width, height, fps: number|null,
  status: 'uploading'|'uploaded'|'validated'|'rejected'|'processing'|'ready'|'failed'|'deleted',
  rejectionReason: string|null,
  context: {            // minimal upload context, asked once
    analyzedTeam: 'us'|'opponent', analyzedUnit: 'offense'|'defense'|'special_teams'|'mixed',
    perspective: 'sideline_fixed'|'endzone'|'broadcast'|'other',
    teamCues: string|null   // "white jerseys, gold helmets" — coach-provided, untrusted text
  },
  quality: FootageQuality|null, storageKey, proxyStorageKey: string|null, thumbnailSheetKey: string|null,
  retentionUntil: string|null, createdAt, updatedAt
}
Upload { id, assetId, teamId, chunkSizeBytes, receivedBytes, totalBytes, expiresAt, completedAt }  // resumable; PUT ranges
FootageQuality { stable: boolean|null, lineOfScrimmageVisible: boolean|null, allTwentyTwoVisible: boolean|null,
                 notes: string[], unevaluable: string[] }   // what could not be assessed, in words
ProcessingJob {
  id, teamId, assetId: string|null, kind: 'validate'|'proxy'|'thumbnails'|'segment'|'infer_labels'|'extract_document'|'reanalyze_segments',
  status: 'queued'|'running'|'retry_wait'|'succeeded'|'failed'|'canceled',
  progress: { done: number, total: number|null, message: string },
  attempt: number, maxAttempts: number, leaseExpiresAt: string|null, workerId: string|null,
  idempotencyKey: string,       // sha256(kind + inputs + config version); a duplicate returns the existing job
  configVersion: string, error: { code, message } | null,
  requestedBy, createdAt, startedAt, finishedAt, canceledAt
}
PlaySegment {
  id, teamId, assetId, gameId, index: number, startSec, endSec,
  origin: 'proposed'|'coach_split'|'coach_merged'|'coach_created',
  reviewStatus: 'proposed'|'accepted'|'rejected',
  supersededBy: string[] ,  // ids after split/merge; the original is kept, never rewritten
  version, createdAt, updatedAt
}
```

Media bytes are served only through `/media/:assetId/stream?token=…` and
`/media/:assetId/thumb/:n?token=…` where the token is an expiring (≤15 min), team-scoped,
HMAC-signed grant created by an authenticated request. No public object URLs.

## 6. Labels, corrections, provenance

```ts
LabelKey =
  | 'unit'                 // offense | defense | special_teams | unknown
  | 'play_type'            // run | pass | other | unknown   (requires temporal evidence)
  | 'formation_family'     // free text from controlled vocabulary per team, or null
  | 'alignment'            // e.g. strength left/right, backfield set; null when not visible
  | 'personnel_estimate'   // e.g. '11', '12' as string or null
  | 'situation_down' | 'situation_distance' | 'situation_field_position' | 'hash'
  | 'motion' | 'result_visible'
  | 'special_teams_type'   // kickoff | punt | fg_pat | return | other

Label {
  id, teamId, segmentId, key: LabelKey,
  inferred: { value: string|null, abstained: boolean, rationale: string, evidence: EvidenceRef[], uncertainty: 'low'|'medium'|'high'|null } | null,
  accepted: { value: string|null, status: 'inferred'|'accepted'|'corrected'|'unknown'|'rejected', byUserId: string|null, at: string|null } ,
  provenanceId: string|null, version, createdAt, updatedAt
}
LabelRevision { id, labelId, previousValue, newValue, previousStatus, newStatus, byUserId, at, reason: string|null }
EvidenceRef { assetId, atSec: number, toSec: number|null, frameIndex: number|null, note: string|null }
ModelProvenance {
  id, provider: 'anthropic'|'openai'|'open_source'|'none', model: string, modelRevision: string|null,
  promptId: string, promptHash: string, preprocessing: { samplingFps: number|null, frameCount: number, clipSec: number|null, resolution: string },
  inspected: { fromSec: number, toSec: number, frameTimestampsSec: number[] },   // exactly what the model saw
  analysisVersion: string, inputTokens, outputTokens, costUsd, latencyMs, requestedAt, completedAt
}
```

Rules: `situation_*`, player identity, assignment, clock, score and outcome are **never**
inferred from nothing; they may be set only from visible evidence (scoreboard/graphic
visible, down marker visible) or by a coach. A model abstention is `abstained: true,
value: null`. Coach corrections live in `accepted` and survive reprocessing: reprocessing
writes a new `inferred` block and never touches `accepted` when `status` is `corrected`
or `accepted`.

## 7. Scouting findings and report snapshots

```ts
ScoutingFinding { id, teamId, opponentId, gameIds: string[], unit, kind: 'formation_frequency'|'play_type_by_formation'|'tendency_by_situation'|'strength'|'weakness'|'uncertain',
  statement, numerator, denominator, percent: number|null, sampleSize, includedSegmentIds: string[], excludedSegmentIds: string[], excludedReason: Record<string,string>,
  reviewBasis: 'reviewed_only'|'includes_inferred', supportingEvidence: EvidenceRef[], contraryEvidence: EvidenceRef[], computedAt, computeVersion }
ReportSnapshot { id, teamId, opponentId, title, findings: ScoutingFinding[], generatedBy, generatedAt, inputsHash }
```

All counts are computed in application code from stored labels and segments. A finding
always states its denominator and whether inferred (unreviewed) labels are included.

## 8. Playbook

```ts
PlaybookDocument { id, teamId, unit, title, assetId, pageCount, status: 'uploaded'|'extracting'|'extracted'|'review'|'failed', createdAt }
PlaybookPage { id, documentId, pageNumber, imageKey, ocrText: string|null, ocrConfidence: number|null }
PlaybookVersion { id, teamId, unit, seasonId, label, status: 'draft'|'approved'|'superseded', approvedBy, approvedAt, supersedes: string|null, createdAt }
Concept { id, teamId, versionId, name, kind: 'run'|'pass'|'protection'|'front'|'coverage'|'pressure'|'special_teams'|'formation'|'other', description, installed: boolean, sources: SourceRef[], status: 'proposed'|'approved'|'rejected', version }
Term { id, teamId, versionId, term, definition, sources: SourceRef[], status }
SourceRef { documentId, pageNumber, bbox: [x0,y0,x1,y1] | null, excerpt: string|null }
```

Extracted material is `proposed` until a coach approves it. OCR text is untrusted data.

## 9. Personnel

```ts
Player { id, teamId, seasonId, jersey: string|null, firstName, lastName, positions: string[], classYear, status: 'active'|'injured'|'unavailable'|'inactive', strengths: string[], developmentPriorities: string[], notes, version }
DepthChart { id, teamId, seasonId, unit, slots: { position: string, order: number, playerId: string }[], version }
PersonnelPackage { id, teamId, seasonId, unit, name, playerIds: string[], description, version }
```

## 10. Recommendations

```ts
Recommendation { id, teamId, gameId, unit, statement, supportingFindings: string[], supportingEvidence: EvidenceRef[], counts: { n: number, of: number, context: string }[],
  limitations: string[], contraryEvidence: EvidenceRef[], playbookConceptIds: string[], personnelPackageIds: string[],
  status: 'proposed'|'accepted'|'edited'|'rejected'|'deferred'|'stale', staleReason: string|null, decidedBy, decidedAt, inputsHash, createdAt, version }
```

Acceptance creates a `PlanItem` in the unit's current **draft** plan. Changing labels,
playbook or personnel that a recommendation depends on sets `status:'stale'` with
`staleReason`; approved plans are never rewritten.

## 11. Weekly unit game plans

```ts
GamePlan { id, teamId, gameId, unit, currentVersionId, createdAt }
GamePlanVersion { id, planId, number, status: 'draft'|'in_review'|'approved'|'superseded', basedOn: string|null,
  sections: PlanSection[], createdBy, createdAt, approvedBy: string|null, approvedAt: string|null, override: boolean, version }
PlanSection { key: OffenseSectionKey|DefenseSectionKey|SpecialTeamsSectionKey, title, items: PlanItem[] }
PlanItem { id, text, sourceRecommendationId: string|null, conceptIds: string[], packageIds: string[], order }
PlanComment { id, versionId, sectionKey: string|null, itemId: string|null, authorUserId, body, createdAt, resolvedAt }
ShareLink { id, teamId, targetType: 'plan_version'|'report_snapshot', targetId, tokenHash, expiresAt, createdBy, revokedAt }

OffenseSectionKey = 'objectives'|'personnel'|'formations'|'runs'|'passes'|'protections'|'opening_script'|'third_down'|'red_zone'|'short_yardage'|'two_minute'
DefenseSectionKey = 'opponent_tendencies'|'fronts'|'fits'|'coverages'|'pressures'|'matchups'|'third_down'|'red_zone'|'short_yardage'|'two_minute'
SpecialTeamsSectionKey = 'kickoff_return'|'punt_protection_return'|'fg_pat'|'opponent_alerts'|'special_situations'
```

Editing an `approved` version creates a new `draft` with `basedOn` set; the approved
snapshot is immutable. Concurrent edits use `expectedVersion` → `409 conflict`.

## 12. API surface (v1, prefix `/api/v1`)

| Area | Routes (initial) |
| --- | --- |
| auth | `POST /auth/sign-in`, `POST /auth/sign-out`, `GET /auth/me`, `POST /auth/mfa/setup`, `POST /auth/mfa/verify`, `POST /auth/invites/:token/accept`, `POST /auth/recovery/request`, `POST /auth/recovery/complete` |
| team | `GET /teams`, `GET /teams/:teamId`, `GET /teams/:teamId/staff`, `POST /teams/:teamId/invites`, `PATCH /teams/:teamId/staff/:membershipId` |
| season/schedule | `GET/POST /teams/:teamId/seasons`, `GET/POST /teams/:teamId/seasons/:seasonId/games`, `PATCH /games/:gameId`, `POST /teams/:teamId/schedule-imports` (preview), `POST /schedule-imports/:id/apply` |
| media | `POST /games/:gameId/uploads` (create), `PUT /uploads/:id` (range), `POST /uploads/:id/complete`, `GET /assets/:id`, `GET /assets/:id/grant` → `{ streamUrl, thumbUrlTemplate, expiresAt }`, `GET /media/:assetId/stream?token=` |
| jobs | `GET /teams/:teamId/jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`, `POST /jobs/:id/retry` |
| segments/labels | `GET /assets/:id/segments`, `POST /segments/:id/split`, `POST /segments/merge`, `PATCH /segments/:id`, `GET /segments/:id/labels`, `PATCH /labels/:id` (correction), `GET /labels/:id/revisions`, `POST /assets/:id/infer` |
| scouting | `GET /teams/:teamId/opponents/:opponentId/scouting?unit=` (computed), `POST …/snapshots` |
| playbook | `POST /teams/:teamId/playbook/documents`, `GET …/documents/:id/pages`, `GET/POST …/playbook/versions`, `PATCH /concepts/:id` |
| personnel | `GET/POST /teams/:teamId/seasons/:seasonId/players`, `POST …/roster-imports`, `PUT …/depth-chart`, `GET/POST …/packages` |
| recommendations | `GET /games/:gameId/recommendations`, `POST /recommendations/:id/decide` |
| plans | `GET /games/:gameId/plans/:unit`, `POST /plan-versions/:id/draft`, `PATCH /plan-versions/:id`, `POST /plan-versions/:id/submit`, `POST /plan-versions/:id/approve`, `POST /plan-versions/:id/comments`, `POST /plan-versions/:id/share`, `GET /plan-versions/:id/export.pdf` |
| ops | `GET /healthz`, `GET /teams/:teamId/usage` (cost accounting) |

Client types come from `hono/client` over the typed app, re-exported from
`packages/contracts` as `ApiClient`; no hand-written fetch types in `apps/web`.
