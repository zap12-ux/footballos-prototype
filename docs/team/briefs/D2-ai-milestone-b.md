# Brief D2 — Applied AI / Scouting Engineer, Milestone B (tasks B4-lib, B5-lib)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` §6–§7 and **§14.5, §14.6, §14.8**, and
`packages/ai/README.md` (your Milestone A work is in `integration`). Worktree:
`/Users/zachariahparkhill/Projects/FootballOS/.worktrees/d2-ai`, branch `wt/d2-ai`.
Allowed paths: `packages/ai/**`, `docs/ai/**`. Still no API key and **no paid call**.

## Deliverables (commit a WIP after each)
1. Replace structural types in `packages/ai/src/types.ts` with imports from
   `@footballos/contracts` (`Label`, `LabelRevision`, `EvidenceRef`, `ModelProvenance`,
   `ScoutingFinding`, `PlaySegment`, `Recommendation`); keep thin aliases; report missing fields
   in the handoff rather than editing contracts.
2. `createInferLabelsHandler({ labeler, extractFrames, budgetUsd, maxFramesPerSegment, labelKeys })`
   per §14.8: per segment, `planFrameSampling` → `extractFrames` (injected; C provides the real
   one) → `labeler.labelSegment` → collect `{ segmentId, labels, provenance }`; `skipped` with
   reasons (`budget_exceeded`, `provider_unavailable` non-retryable, `no_frames`); honours
   `ctx.signal` between segments; `ctx.progress(done,total,message)`; one shared `JobBudget` per
   job; total `costUsd`. Tests with a fake labeler and fake frame extractor: order, abort,
   budget stop, provider failure surfaces as the job error with `retryable` preserved.
3. `applyInference(existing: Label[], segmentId, inferred: InferredLabel[], provenanceId)` →
   `{ upserts: Label[] }`: creates labels for new keys with `accepted = { value: inferred.value,
   status: 'inferred' }` (or `unknown` when abstained), updates `inferred` on existing labels, and
   **never** modifies `accepted` when its status is `accepted`/`corrected`/`rejected`; bumps
   `version`. Tests: corrected label survives three reprocessings with different inferences;
   abstention produces `unknown`; a previously inferred value is replaced.
4. `bulkAcceptPlan(labels, { segmentIds, keys })` → `{ toAccept: labelIds, skipped: { id, reason }[] }`
   (only `inferred` status and not abstained) so B's route and A's UI agree on the rule.
5. Scouting service helpers: `buildScoutingReport({ segments, labels, assets, games, unit,
   reviewBasis })` → the §14.6 response body (findings, games with assetIds, sampleSize,
   computeVersion) and `snapshotFromReport(report, title, generatedBy)` → `ReportSnapshot` with
   `inputsHash`. Tests with hand-computed expectations including games included/excluded.
6. `docs/ai/EVALUATION_PLAN.md`: add the "first live call" checklist (single segment, confirm
   request shape, record provenance) and the coach-labeled-set format B's export must produce.

## Acceptance (board B4-lib/B5-lib)
`npm run typecheck -w packages/ai`, `npm test -w packages/ai` green; signatures exactly as §14.8.

## Owner question
None expected. The $25 default per-job budget stands (owner answer, Milestone A).
