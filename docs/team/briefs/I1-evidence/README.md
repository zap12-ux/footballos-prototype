# Iteration 1 evidence

One screenshot per mechanism from a walk of the round-1 reviewer sequences against the
web app in mock mode (`npm run dev -w apps/web`, `VITE_API_MODE=mock`, demo head-coach
account), captured on this branch (regenerated 2026-11-22 after the round-2 follow-ups). Every record shown is fictional demo data.

| File | Mechanism | Sequence walked | What the screenshot shows |
| --- | --- | --- | --- |
| `m1-unsaved-work-guard-HC-01.png` | 1 · unsaved-work guard | HC-01: add a third objective to offense v2, switch to Special teams without Save draft, switch back | Objectives (3) with the Sunday protection check still listed, **Save draft** enabled, the "Unsaved changes" tag and a Discard link; the page no longer says "Draft saved". |
| `m2-evidence-links-OC-02.png` | 2 · evidence links | OC-02 / HC-05: on Opponent Scouting (Westmoor offense) follow the 2:01 link under the trips finding (after the OC-11 seed fix the defensive cards, which have no labeled plays, say "No supporting play on file") | Play 1 (2:00–2:07) selected, the playhead reading 2:01, and the player caption "Demo proxy: stand-in footage for 2:01 (play 1, 2:00–2:07). The credited clip is not this snap…". |
| `m3-approval-history-HC-03.png` | 3 · approval history | HC-03: head coach approves offense v2 with an override reason, then selects the superseded v1 | v1 still shows "Approved Thu, Oct 22, 5:10 PM by Marcus Ellery" and adds "Superseded … by v2 (approved by Dana Whitlock, head-coach override)". |
| `m4-mock-persistence-OC-01-PC-04.png` | 4 · mock persistence | OC-01 / PC-04: reload the browser after the approval (v2 stays approved), open Settings, press Reset demo data | The Demo data card ("kept across reloads; last saved …") behind the confirmation that lists exactly what a reset clears and says sign-in and unsaved drafts are kept. |

The same four sequences are the Vitest files under `apps/web/src/tests/iteration1/`, which
fail on the `integration` baseline (f48a241 / 4b14797) and pass on this branch.

## Regenerating

`walk.mjs` drives a headless Google Chrome over the DevTools protocol (no extra packages;
Node 22+ for the built-in `WebSocket`). With the dev server running on port 5173:

```bash
node docs/team/briefs/I1-evidence/walk.mjs http://localhost:5173 docs/team/briefs/I1-evidence
```

It signs in with the demo head-coach account, performs the four sequences above in order and
overwrites the four PNGs. It cancels the reset dialog, so the mock store in that Chrome
profile is left as the walk made it; the profile is a throwaway under `/tmp`.
