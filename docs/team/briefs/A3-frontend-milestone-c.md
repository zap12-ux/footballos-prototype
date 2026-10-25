# Brief A3 — Product Designer / Frontend Engineer, Milestone C (task C4)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` **§15** (authoritative), §3, §8–§11, and
`apps/web/README.md`. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/a3-frontend`,
branch `wt/a3-frontend`. Allowed paths: `apps/web/**`. Web dev port 5174; API proxy target
`http://127.0.0.1:8789` (B's dev API may not be running; everything must also work in
`VITE_API_MODE=mock`). The Backend engineer builds §15 in parallel; code against the contract
and extend the mock first.

## Deliverables (commit a WIP after each)
1. API layer: add every §15 operation to the `Api` interface, `MockApi` (demo data: two
   playbook documents with pages and proposed/approved concepts and terms, a roster of 25
   players with availability, depth charts, packages, eight recommendations in every status
   including `stale`, plans for all three units with draft/in_review/approved/superseded
   versions, comments, a share link) and `HttpApi` via `hc<AppType>` once B's routes exist
   (use `raw()` for routes not yet typed).
2. **Playbook** page: documents list with extraction status and warnings; upload (reuse the
   chunked upload client with `kind:'document'`); document view with page images (grant),
   page text when present and "no text layer / OCR not available" states verbatim;
   proposals review table (concept name, kind, source page link that scrolls the page into
   view, basis text/model, note) with approve/reject/edit, "installed" toggle, coach-created
   concepts; versions list with approve (coordinator/head coach) and supersession shown;
   terms tab. Never present an extracted proposal as approved.
3. **Personnel** page: roster table with inline edit, CSV import preview → apply with row
   errors, availability per week editor (available/limited/out with note), strengths and
   development priorities, depth chart editor per unit (keyboard reorder, `expectedVersion`
   409 handling), packages editor flagging unavailable players for the selected game.
4. **Weekly Game Plans** page, real workflow: unit tabs; version picker with status badges;
   draft editor per §11 template (sections, items with reorder, concept and package pickers
   limited to installed/available), autosave with visible saving/saved/error and 409
   "changed elsewhere" merge dialog showing the server copy side by side; submit, approve
   (coordinator of the unit) or override (head coach, labelled), reopen, new draft from
   approved; review flags banner (stale recommendation, playbook/personnel/labels changed)
   with links; comments panel (section/item anchored, resolve); share link dialog (expiry,
   token shown once, copy, revoke) and the read-only `/shared/:token` route (public layout,
   no session, 410 state); print view (`export.html` in a new tab) and PDF download.
5. **Recommendations** panel inside Game Plans (and a card on the dashboard): generate
   (coordinator/head coach), list with status chips and stale reason, each item shows
   statement, counts with context, supporting plays with timestamps linking to the asset
   view, limitations, contrary evidence, grounded concepts and packages; accept (→ draft item,
   with a toast linking to it), edit (inline statement edit then accept), reject, defer;
   `blockedReasons` shown plainly when generation yields nothing. AI never approves anything;
   copy must say so.
6. Dashboard: open tasks derived from real data (proposals awaiting review, plans in review,
   stale flags, invites pending).
7. Tests: mock-mode tests for each page's core interactions (approve concept, approve version,
   roster import preview/apply, depth chart 409, package availability flag, recommendation
   accept creates draft item, plan autosave + 409 merge dialog, approve by role, share link
   lifecycle incl. 410, review flags banner), axe on playbook, personnel and plans pages;
   existing 125 tests keep passing. `npm run typecheck -w apps/web`, `npm test -w apps/web`,
   `npm run build -w apps/web`.
8. README: coaching workflow pages, roles, keyboard interactions.

## Acceptance (board C4)
Mock mode complete with tests; against B's API: upload a text PDF, approve a concept and the
version, import a roster, generate recommendations, accept one into a draft plan, submit,
approve as coordinator, share, open the shared link, print and download the PDF.

## Owner question you may ask (non-blocking)
Whether the shared read-only plan page should show comments (recommend: no; comments stay
internal). Nothing else.
