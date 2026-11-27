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
| Approve a unit plan | `coordinator` of that unit; `head_coach` (recorded as `override: true` with a required `overrideReason`, iteration 1 / D-014) |
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
  id, provider: 'ollama', model: string, modelRevision: string|null,   // provider: local Ollama server (2026-11-27)
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
  sections: PlanSection[], createdBy, createdAt, approvedBy: string|null, approvedAt: string|null, override: boolean,
  overrideReason: string|null,            // required (non-empty) when override is true; iteration 1, D-014
  supersededAt: string|null, supersededByVersionId: string|null,   // set on the old approved version when a later one is approved
  version }
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

Approval history (iteration 1, D-014, HC-03 / HC-07): a version's `approvedBy`, `approvedAt`,
`override` and `overrideReason` are never cleared or rewritten. Approving a later version sets
the previous approved version to `superseded` and fills its `supersededAt` and
`supersededByVersionId`; the UI shows that history for a superseded version exactly as for an
approved one. A head-coach approval is always an override and must carry `overrideReason`
(`400 validation_error` without it); the audit event (`plan.override_approved`) carries the
same reason. A plan has at most one `draft` at a time: `POST /plan-versions/:id/draft` answers
`409 conflict` with `details.reason: 'draft_exists'` and `details.versionId`, and the UI opens
that draft instead of creating another.

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

Client types: `apps/api` exports `type AppType` (the typed Hono app) and `apps/web`
imports it **type-only** (`import type { AppType } from '@footballos/api'`) to build a
`hono/client` client. `packages/contracts` holds only zod schemas and inferred types so it
never depends on the API package. No hand-written fetch types in `apps/web`.

## 13. Additions made by the contracts package (v0.2, 2026-10-25, owner B)

The package now also defines: `ImportRowError { row, column | null, message }`,
`ScheduleImportRow`, `ScheduleImport.rows`, `ScheduleImportPreviewRequest.seasonId`,
`SeasonRecord.played`, a `GameResult` outcome/score consistency refinement,
`AuditEvent.actorUserId` nullable, an `AuditAction` enum, `Invite.createdAt`, `User`
without `passwordHash`, `StaffMember` (membership + user), `AuthState`, `Usage`, `Health`.
Routes beyond §12: `GET/DELETE /teams/:teamId/invites[/:inviteId]`,
`GET /teams/:teamId/audit`, `GET/POST /teams/:teamId/opponents`, `GET /games/:gameId`,
`GET /schedule-imports/:id`, `POST /schedule-imports/:id/discard`. Season, opponent, game
creation and schedule imports are allowed for `head_coach` and `coordinator` (lead decision,
pending owner objection). Password hashing: scrypt (`node:crypto`). MFA gate: `401` with
`details.mfaRequired`, plus `details.mfaEnrollmentRequired` for head coaches and
coordinators without MFA. Media (`packages/media`) and AI (`packages/ai`) currently carry
structural copies of §5–§7/§10 types; swapping them for package imports is a Milestone B
chore. Proposed job-table fields from C: `input`, `result`, `notBeforeAt`,
`cancelRequestedAt` (store-internal until adopted here).

## 14. Milestone B addendum (v0.3, 2026-10-25) — film workflow API and job hosting

Implemented by B in `apps/api`; consumed by A in `apps/web`; library pieces from C
(`packages/media`) and D (`packages/ai`). Everything here is authoritative for Milestone B.

### 14.1 Resumable uploads
- `POST /games/:gameId/uploads` `{ filename, byteSize, mimeType, sha256?, context: MediaAsset.context }`
  → `201 { upload: Upload, asset: MediaAsset(status:'uploading') }`. If `sha256` is given and an
  asset with that hash exists in the team → `409 conflict`, `details.existingAssetId`.
  Limits from env (`MAX_UPLOAD_BYTES`, `ALLOWED_VIDEO_CONTAINERS`) → `413` / `400`.
- `PUT /uploads/:uploadId` with `Content-Range: bytes <start>-<end>/<total>` and a raw body of at
  most `UPLOAD_CHUNK_BYTES` → `200 { receivedBytes }`. Chunks must be contiguous (`start ==
  receivedBytes`), otherwise `409 conflict` with `details.receivedBytes` (client resumes from it).
- `GET /uploads/:uploadId` → `{ upload }` (for resume after reload). Uploads expire after
  `UPLOAD_TTL_HOURS` (default 24) and are garbage-collected with their partial file.
- `POST /uploads/:uploadId/complete` → server computes sha256 of the stored file; mismatch with a
  client-provided hash → `400`; duplicate of an existing asset → `409` with `existingAssetId` and
  the partial file is deleted; otherwise asset `uploaded`, a job chain is enqueued
  (`validate` → `proxy` → `thumbnails` → `segment`, each idempotent by
  `idempotencyKey = sha256(kind + assetId + configVersion)`) → `200 { asset, jobs: ProcessingJob[] }`.
- `GET /games/:gameId/assets` → `{ items: MediaAsset[] }`; `GET /assets/:assetId` → `{ asset }`;
  `DELETE /assets/:assetId` (head coach; retention action; audit) → `204`.

### 14.2 Jobs and the worker
- `GET /teams/:teamId/jobs?assetId=&status=&limit=&cursor=` → paginated `ProcessingJob`.
- `GET /jobs/:jobId` → `{ job }`; `POST /jobs/:jobId/cancel` → `{ job }` (`cancelRequestedAt`
  set; running handlers see `signal.aborted`); `POST /jobs/:jobId/retry` → `{ job }` (allowed from
  `failed`/`canceled`; resets attempt counter; same idempotency key).
- Job table adds the store-internal fields proposed by C: `input` (json), `result` (json),
  `notBeforeAt`, `cancelRequestedAt`. B implements `SqliteJobStore` against
  `packages/media/src/jobs/types.ts` (`JobStore`).
- Worker: `npm run worker -w apps/api` runs the `JobRunner` from `packages/media` with
  `WORKER_CONCURRENCY`, `JOB_LEASE_SECONDS`, `JOB_MAX_ATTEMPTS`; `WORKER_INLINE=true` runs it inside
  the API process for development. It calls `recoverExpiredLeases()` on start and on every
  maintenance tick (`WORKER_MAINTENANCE_SEC`, default 60).
- Handlers registered by B: `validate`, `proxy`, `thumbnails`, `segment` from
  `createMediaHandlers()` (C) and `infer_labels` from `createInferLabelsHandler()` (D). B persists
  each handler's result into `MediaAsset` (quality, proxy/thumbnail keys, status) or
  `PlaySegment`/`Label` rows inside one transaction per job completion.

### 14.3 Media delivery
- `GET /assets/:assetId/grant` → `{ streamUrl, thumbUrlTemplate, expiresAt }` where URLs carry an
  HMAC token (`MEDIA_GRANT_TTL_MIN`, default 15) bound to team + asset.
- `GET /media/:assetId/stream?token=` serves the proxy when present, else the original, with HTTP
  `Range` support; `GET /media/:assetId/thumb/:n?token=` serves tile `n` of the thumbnail sheet
  (or a single frame file). Expired/foreign token → `401`.

### 14.4 Segments
- `GET /assets/:assetId/segments` → `{ items: PlaySegment[] }` (non-superseded, ordered).
- `POST /segments/:segmentId/split { atSec, expectedVersion }` → `{ segments: [a, b], superseded }`.
- `POST /segments/merge { segmentIds: [..], expectedVersion: { [id]: n } }` → `{ segment, superseded }`.
- `PATCH /segments/:segmentId { reviewStatus?, startSec?, endSec?, expectedVersion }` → `{ segment }`.
- `POST /assets/:assetId/segments { startSec, endSec }` (coach-created) → `201 { segment }`.

### 14.5 Labels, corrections, inference
- `POST /assets/:assetId/infer { segmentIds?: string[], labelKeys?: LabelKey[] }` → `202 { jobs }`.
  One `infer_labels` job per batch of at most `FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB` segments.
  When the Ollama preflight fails (server not running, model not pulled, model without image
  input) the job fails immediately with `error.code='provider_unavailable'`, `retryable:false`
  and a message that names the reason (`unreachable: …`, `model_missing: …`,
  `model_not_vision: …`) and the fix; manual labeling stays available. Reprocessing writes a new `inferred` block and a
  new `ModelProvenance`; it never changes `accepted` when `accepted.status ∈ {accepted, corrected}`.
- `GET /segments/:segmentId/labels` → `{ items: Label[] }`; `GET /assets/:assetId/labels` →
  `{ items: Label[] }` (all segments, for review tables).
- `PATCH /labels/:labelId { accepted: { value, status: 'accepted'|'corrected'|'unknown'|'rejected' }, reason?, expectedVersion }`
  → `{ label, changed }`; writes a `LabelRevision` unless the request is a no-op (`changed:false`);
  `GET /labels/:labelId/revisions` → `{ items }`.
- `POST /assets/:assetId/labels/bulk-accept { segmentIds, keys }` → `{ accepted: n, skipped: n }`;
  only labels whose `accepted.status === 'inferred'` and `inferred.abstained === false` change.
- `GET /assets/:assetId/provenance` → `{ items: ModelProvenance[] }`.

### 14.6 Scouting (computed, never stored except snapshots)
- `GET /teams/:teamId/opponents/:opponentId/scouting?unit=&reviewBasis=reviewed_only|includes_inferred&gameIds=`
  → `{ findings: ScoutingFinding[], games: { gameId, assetIds }[], sampleSize, computedAt, computeVersion }`
  computed with `packages/ai` `computeFindings` over stored segments and labels of assets whose
  `context.analyzedTeam === 'opponent'` for that opponent's games.
- `POST …/scouting/snapshots { title }` → `201 { snapshot: ReportSnapshot }`;
  `GET …/scouting/snapshots` → `{ items }`.

### 14.7 Team settings (proposed route adopted)
- `GET /teams/:teamId/settings` → `{ settings: { retentionDays: number|null, uploadLimits, version } }`;
  `PATCH` with `expectedVersion` (head coach).

### 14.8 Library interfaces owed by C and D (for B to host)
- C: `extractFrames(src, timestampsSec: number[], { height?: 720 }) → Promise<{ atSec, jpeg: Buffer, width, height }[]>`;
  `createMediaHandlers({ dataDir, limits, proxy: { height }, thumbnails: { everySec } }) →
  { validate, proxy, thumbnails, segment }`, each `async (job: { id, input }, ctx: { signal, progress(done,total,message) }) => result`
  with `input = { assetId, sourcePath, outDir }` and results: `validate → { ok, reasons, probe, quality }`,
  `proxy → { proxyPath, mapping, durationDriftSec }`, `thumbnails → { sheetPath, everySec, count, framesDir? }`,
  `segment → { segments: PlaySegment-shaped[], confidenceNote }`.
- D: `createInferLabelsHandler({ labeler, extractFrames, budgetUsd, maxFramesPerSegment }) →
  async (job: { id, input: { assetId, sourcePath, context, labelKeys, segments: { id, startSec, endSec, fps }[] } }, ctx) =>
  { perSegment: { segmentId, labels: InferredLabel[], provenance: ModelProvenance }[], skipped: { segmentId, reason }[], costUsd }`
  and `applyInference(existing: Label[], segmentId, inferred: InferredLabel[], provenanceId) → { upserts: Label[] }`
  that preserves `accepted` when its status is `accepted`/`corrected`.
- Both packages import their record types from `@footballos/contracts` from Milestone B on.

### 14.9 Adjustments made during implementation (B, 2026-10-25)
- `processing_jobs` also carries `depends_on_job_id` (chain ordering; a job is claimable only
  when its dependency `succeeded`); dependents of a failed job become `failed` and dependents of a canceled job become
  `canceled`, in both cases with `error.code = 'upstream_failed'` (QA D-6 correction). `JobError.retryable?` added.
  `ProcessingJob.notBeforeAt` and `cancelRequestedAt` are optional in the schema.
- `MediaAsset.sha256` is `null` while `status = 'uploading'`.
- Every `PlaySegment` is created with one `Label` row per `LabelKey` (12) in
  `accepted.status = 'unknown'` with `inferred = null`; the UI treats that as "not labeled".
  Split and merge create fresh `unknown` labels on the new segments; superseded segments keep
  theirs for audit. Re-running `segment` replaces only proposals no coach has touched.
- `POST /assets/:id/infer` returns a pending batch when one exists and starts a new generation
  after a finished one. `GET /teams/:teamId/jobs` cursor is `createdAt|id`.
- New env: `UPLOAD_TTL_HOURS`, `MEDIA_GRANT_TTL_MIN`, `WORKER_INLINE`, `WORKER_POLL_MS`,
  `PROXY_HEIGHT`, `THUMBNAIL_EVERY_SEC`; removed `MODEL_ID`, `MAX_FRAMES_PER_SEGMENT` (the
  `FOOTBALLOS_AI_*` names are authoritative).

### 14.10 Decisions after QA B6 (lead, 2026-10-25)
- A `PATCH /labels/:id` whose `accepted` block equals the current one is a no-op: no version
  bump, no revision row, `200 { label, changed: false }` (QA D-5).
- `GET /media/:assetId/stream` and `thumb` serve only assets in `validated|processing|ready`;
  anything else is `404`. The response `Content-Type` comes from the probe (container), never
  from the client-supplied `mimeType`; responses carry `Content-Disposition: inline;
  filename="<assetId>.<ext>"`, `X-Content-Type-Options: nosniff` and a restrictive
  `Content-Security-Policy: default-src 'none'` (QA D-1).
- Expired leases are recovered on every maintenance tick and `claim()` may take a `running`
  row whose lease has expired (QA D-2).
- A model failure names its reason in the message (`unreachable`, `model_missing`,
  `model_not_vision`, …) and happens before any frame is extracted, so the error names the real
  cause (QA D-4). Local inference has no per-call cost: `ModelProvenance.costUsd` is 0 and
  `Usage.monthlyCostCapUsd` is `null`. `retentionDays` minimum stays 1 (QA O-1).
- `originalFilename` is sanitized on intake: control characters removed, a stem is required,
  length capped at 255 (QA D-7).

## 15. Milestone C addendum (v0.4, 2026-10-25) — playbook, personnel, recommendations, unit plans

Implemented by B in `apps/api` (schema `0002_coaching`), consumed by A in `apps/web`; library
pieces from C (`packages/media`: document extraction) and D (`packages/ai`: concept proposals,
recommendation grounding). Records are §8–§11; this section fixes routes and rules.

### 15.1 Playbook intake and review
- `MediaAsset.gameId` is nullable **for documents only** (film assets always carry a game).
  Playbook documents are created by `POST /teams/:teamId/playbook/documents { filename,
  byteSize, mimeType, sha256?, unit, title? }` (asset `gameId: null`) or, when game-bound, by
  `POST /games/:gameId/uploads` with `kind:'document', unit`. Migration `0003_coaching`
  rebuilds `media_assets` with a nullable `game_id` (accepted from B, 2026-10-25).
- Upload a document through §14.1 with `kind: 'document'` (PDF; `.docx`/`.txt` accepted as
  "text documents" where `extractDocument` supports them) and `context` omitted; completion
  enqueues `extract_document` (idempotent per sha256 + `configVersion`).
- `extract_document` result → `PlaybookDocument { pageCount, status: 'extracted' }`,
  `PlaybookPage` rows (`imageKey` = rendered page PNG under the asset dir, `ocrText` or
  `text` from the PDF text layer, `ocrConfidence` or `null`, `textSource:
  'pdf_text'|'ocr'|'none'`), and **proposed** `Concept` and `Term` rows (`status:'proposed'`)
  each with `sources: SourceRef[]` pointing at page numbers (and `bbox` when known). Without an
  OCR engine or model, scanned pages produce `textSource:'none'` and no proposals; the UI says
  so. A diagram is never "understood" from text: proposals carry `basis: 'text'|'model'` and a
  `note` string.
- Routes: `GET /teams/:teamId/playbook/documents?unit=` → `{ items }`; `GET …/documents/:id`
  → `{ document, pages: PlaybookPage[] }`; `GET /playbook/pages/:pageId/image?token=` via a
  media grant (`GET /playbook/documents/:id/grant`); `DELETE …/documents/:id` (head coach).
- Versions: `GET/POST /teams/:teamId/playbook/versions?unit=` (POST `{ unit, seasonId, label }`
  → draft); `GET /playbook/versions/:id/concepts` and `/terms` → `{ items }` (proposed +
  approved + rejected, filter `status=`); `PATCH /concepts/:id` and `PATCH /terms/:id`
  `{ status: 'approved'|'rejected', name?, kind?, description?, installed?, expectedVersion }`
  (coordinator of the unit or head coach); `POST /playbook/versions/:id/concepts` (coach-created,
  `status:'approved'`, `sources: []`); `POST /playbook/versions/:id/approve` → `approved`,
  previous approved version → `superseded` (coordinator/head coach; audit `playbook.approved`).
  Only concepts in the **approved** version with `installed: true` ground recommendations.

### 15.2 Personnel
- `GET/POST /teams/:teamId/seasons/:seasonId/players`, `PATCH /players/:id`
  (`expectedVersion`), `DELETE /players/:id` (head coach; soft, `status:'inactive'`).
- Roster import: `POST /teams/:teamId/seasons/:seasonId/roster-imports` (CSV, same preview
  machinery as schedule imports: header auto-mapping for jersey, first, last, positions, class)
  → preview; `POST /roster-imports/:id/apply` (`skipInvalidRows`) → `{ createdPlayerIds,
  updatedPlayerIds }` (match on jersey + last name).
- `GET/PUT /teams/:teamId/seasons/:seasonId/depth-chart?unit=` (`PUT { slots, expectedVersion }`),
  `GET/POST /teams/:teamId/seasons/:seasonId/packages`, `PATCH /packages/:id`.
- Availability: `Player.status` plus `Player.availability: { week: number, status:
  'available'|'limited'|'out', note }[]` (season-specific). Packages whose players are `out`
  for the selected game are `unavailable` in recommendations.
- Permissions: edit by head coach and coordinators; view by any member.

### 15.3 Recommendations (computed, stored, never auto-approved)
- `POST /games/:gameId/recommendations/generate { unit }` (coordinator/head coach) →
  `201 { items: Recommendation[] }` built by `buildRecommendations` from the current scouting
  report for that opponent/unit (reviewed-only basis), the approved playbook version's
  installed concepts, and current personnel/availability for the game week. Each carries
  `inputsHash` over those inputs. Re-generating supersedes undecided recommendations
  (`status:'rejected'`, `staleReason:'regenerated'`) and leaves decided ones.
- `GET /games/:gameId/recommendations?unit=` → `{ items }` where each item's `status` is
  reported as `stale` (with `staleReason`) when its `inputsHash` no longer matches the current
  inputs, without rewriting the stored decision. `POST /recommendations/:id/decide
  { decision: 'accept'|'edit'|'reject'|'defer', editedStatement?, note? }` (coordinator/head
  coach): `accept`/`edit` create a `PlanItem` in the unit's **current draft** plan version
  (creating a draft if none, §15.4) with `sourceRecommendationId`; audit
  `recommendation.decided`.
- Grounding rules (D): a recommendation references only installed approved concepts and only
  packages that are available; it lists supporting findings (ids), evidence refs with
  timestamps, counts with context, limitations (sample size, review basis, missing situations)
  and contrary evidence when a finding points the other way. With no approved playbook or no
  personnel, generation returns `[]` plus `blockedReasons[]` rather than ungrounded items.

### 15.4 Unit game plans, approval, sharing, export
- `GET /games/:gameId/plans/:unit` → `{ plan, versions: GamePlanVersion[] (summaries),
  current: GamePlanVersion (full), reviewFlags: ReviewFlag[] }`; first access creates
  `GamePlan` with draft version 1 from the unit template (§11 section keys, empty items).
- `PATCH /plan-versions/:id { sections, expectedVersion }` (draft only; editor = head coach or
  assigned staff whose `units` contains the unit) → `{ version }`; `409` on mismatch with
  `currentVersion` and the **server copy** so the client can merge; approved/superseded
  versions are immutable (`409 conflict`, `details.reason:'not_draft'`).
- `POST /plan-versions/:id/draft` → new draft `basedOn` an approved version (copy of
  sections), `{ version }`; at most one draft per plan (`409` if one exists).
- `POST /plan-versions/:id/submit` → `in_review`; `POST /plan-versions/:id/approve
  { note?, overrideReason? }` → `approved` (coordinator of the unit; head coach sets
  `override:true` and must send `overrideReason`, else `400`), previous approved →
  `superseded` with `supersededAt` and `supersededByVersionId` set and its own approval fields
  kept; `POST /plan-versions/:id/reopen` → back to `draft` (coordinator/head coach); every
  transition audited with actor, note and, for overrides, the reason (iteration 1, D-014).
- `ReviewFlag { kind: 'stale_recommendation'|'playbook_changed'|'personnel_changed'|'labels_changed',
  message, itemId?, since }` computed on read for the current approved and draft versions by
  comparing stored `inputsHash` values against current inputs; never mutates versions.
- Comments: `GET/POST /plan-versions/:id/comments` (`{ sectionKey?, itemId?, body }`, any member),
  `POST /plan-comments/:id/resolve`.
- Sharing: `POST /plan-versions/:id/share { expiresInHours ≤ 72 }` (owner decision 2026-10-25; was 168) → `{ link: ShareLink,
  url }` (token shown once); `GET /shared/:token` → read-only `{ version, team: { name },
  game, unit, expiresAt }` for **approved** versions only, no session required, team-scoped
  token, `410` after expiry or revoke; `DELETE /share-links/:id` (creator or head coach);
  `GET /teams/:teamId/share-links` (head coach). Audit `plan.shared`, `plan.share_revoked`.
- Export: `GET /plan-versions/:id/export.html` (print stylesheet, session or share token) and
  `GET /plan-versions/:id/export.pdf` generated server-side with `pdf-lib` (MIT): title block
  (team, opponent, week, unit, version, status, approved by/at), one section per template key,
  items, and a footer "Generated by FootballOS <date> · version n". No analytics or external
  fonts.

### 15.5 Library interfaces owed by C and D
- C: `extractDocument(path, outDir, { renderDpi = 110, ocr: 'auto'|'off' })` →
  `{ pageCount, pages: { pageNumber, imagePath, width, height, text: string|null,
  textSource: 'pdf_text'|'ocr'|'none', ocrConfidence: number|null }[], warnings[] }` using
  `pdfjs-dist` (Apache-2.0) + `@napi-rs/canvas` (MIT); OCR via `tesseract.js`
  (Apache-2.0) **only if** its language data can be installed from an npm package with an
  allowed license — otherwise `ocr:'off'` with a warning; `.txt`/`.md` → one page per 60 lines
  with `textSource:'pdf_text'`; `.docx` via `mammoth` (BSD-2-Clause) to text if trivial, else
  rejected with a plain reason. `createDocumentHandlers({ dataDir })` → `{ extract_document }`
  with the §14.8 handler shape, input `{ assetId, sourcePath, outDir }`.
- D: `proposeFromPages(pages, { labeler? , vocabulary? })` → `{ concepts: ProposedConcept[],
  terms: ProposedTerm[], basis: 'text'|'model'|'none', note }` where text heuristics find
  headings/numbered play names and "Term — definition" lines; a model (image pages) is used
  only when a labeler is available, with abstention and provenance;
  `buildRecommendations({ report, playbook: { versionId, concepts }, personnel: { players,
  packages, depthChart, week }, unit, gameId })` → `{ items: Recommendation[], blockedReasons[],
  inputsHash }`; `recommendationInputsHash(inputs)`; `planReviewFlags({ version, recommendations,
  currentHashes })` → `ReviewFlag[]`.
