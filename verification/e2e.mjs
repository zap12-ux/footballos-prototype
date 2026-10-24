/**
 * Optional end-to-end verification of the prototype workflow in a real browser.
 *
 * This is a developer utility, not part of the prototype. It expects a build of
 * the app to be served at BASE_URL and Playwright to be available:
 *
 *   npm run build && npx vite preview --port 4173
 *   BASE_URL=http://localhost:4173 node verification/e2e.mjs
 *
 * The repository's primary test suite is `npm test` (Vitest + React Testing Library).
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.env.SHOT_DIR ?? '/tmp/fos-shots';

const problems = [];
let step = 0;
const ok = (msg) => console.log(`  ok  ${++step}. ${msg}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem('footballos.prototype.v2') ?? '{}'));

// The landing page is the entry point; the research flow (Screen 1, baseline first) is at #/research.
await page.goto(`${BASE_URL}#/research`);

// --- Screen 1: baseline before the task -------------------------------------
await page.getByLabel('Minutes', { exact: true }).fill('20');
await page.getByRole('button', { name: 'Film plus paper or a spreadsheet' }).click();
await page.getByRole('radio', { name: 'No', exact: true }).click();
await page.getByRole('button', { name: 'Begin Review' }).click();
await page.getByRole('heading', { name: 'Team context' }).waitFor();
let s = await state();
assert.equal(s.baseline.capturedBeforeReviewTask, true);
assert.equal(s.baseline.exposure.enteredVia, 'research_link');
assert.equal(s.baseline.minutesForSixSnaps, 20);
const evNames = s.events.map((e) => e.event);
assert.ok(evNames.indexOf('baseline_captured') < evNames.indexOf('session_started'));
ok('baseline captured before the review task');

// --- Screen 2 + 3 -----------------------------------------------------------
await page.getByRole('button', { name: 'Continue to film' }).click();
assert.equal(
  await page.getByTestId('film-check-statement').innerText(),
  '4 of 6 snaps look gradable for interior offensive line. Play 3 and Play 6 are likely to come back No Grade.',
);
ok('coverage is forecast before the coach starts reviewing');

await page.getByLabel('Video link (optional)').fill('https://www.youtube.com/watch?v=example');
await page.getByRole('button', { name: 'Record this link' }).click();
await page.getByTestId('link-recorded').waitFor();
s = await state();
assert.equal(s.filmLinkHost, 'www.youtube.com');
assert.equal(s.filmSource, null);
assert.equal(s.events.find((e) => e.event === 'film_link_pasted')?.data?.host, 'www.youtube.com');
assert.ok(!JSON.stringify(s).includes('v=example'));
ok('a pasted link is reduced to its host, fetches nothing, and the URL is not stored');

await page.getByRole('button', { name: 'Use Demo Film' }).click();
await page.getByRole('heading', { name: 'Review queue' }).waitFor({ timeout: 15000 });
assert.match(
  await page.getByTestId('coverage-progress').innerText(),
  /0 of 6 reviewed · 0 graded · 0 No Grade/,
);
ok('demo film runs simulated processing through to the review queue');

assert.match(await page.getByTestId('film-check-banner').innerText(), /4 of 6 snaps look gradable/);
ok('the queue repeats the coverage forecast before any play is opened');

const row = (n) => page.getByRole('row', { name: new RegExp(`^Play ${n}\\b`) });
const openPlay = async (n) => {
  await row(n).getByRole('button', { name: /Review Play|Reopen Play/ }).click();
  await page.getByRole('heading', { name: 'Play and player' }).waitFor();
};
const backToQueue = async () => {
  await page.getByRole('button', { name: 'Back to queue' }).click();
  await page.getByRole('heading', { name: 'Review queue' }).waitFor();
};

assert.match(await row(4).innerText(), /Not yet reviewed — your grade first/);
ok('Play 4 candidate is withheld in the queue');

// --- Play 1: coach No Grade, then accept ------------------------------------
await openPlay(1);
await page.getByRole('button', { name: 'Mark No Grade' }).click();
assert.equal(await page.getByTestId('decision-recorded').count(), 0);
await page.getByRole('button', { name: 'Player not visible' }).click();
await page.getByTestId('decision-recorded').waitFor();
s = await state();
assert.equal(s.decisions['play-1'].action, 'no_grade');
assert.deepEqual(s.decisions['play-1'].reasonCodes, ['not_visible']);
ok('coach No Grade requires and records a structured reason');

await page.getByRole('button', { name: /Accept candidate/ }).click();
await page.waitForFunction(() =>
  JSON.parse(localStorage.getItem('footballos.prototype.v2')).decisions['play-1'].action ===
  'accepted',
);
s = await state();
assert.equal(s.decisions['play-1'].finalGrade, 3);
assert.deepEqual(s.decisions['play-1'].reasonCodes, []);
ok('accepting an unchanged candidate needs no reason');
await backToQueue();
assert.match(
  await page.getByTestId('coverage-progress').innerText(),
  /1 of 6 reviewed · 1 graded · 0 No Grade/,
);
ok('progress and coverage update together');

// --- Play 2: change grade in two interactions -------------------------------
await openPlay(2);
await page.getByRole('button', { name: 'Change to Grade 1' }).click();
assert.equal(await page.getByTestId('decision-recorded').count(), 0);
await page.getByRole('button', { name: 'Hand placement', exact: true }).click();
await page.getByTestId('decision-recorded').waitFor();
s = await state();
assert.equal(s.decisions['play-2'].action, 'changed');
assert.equal(s.decisions['play-2'].finalGrade, 1);
assert.deepEqual(s.decisions['play-2'].reasonCodes, ['hand_placement']);
ok('grade change completes in two interactions with a structured reason');
await backToQueue();

// --- Play 3: accept the abstention ------------------------------------------
await openPlay(3);
assert.match(await page.innerText('body'), /Player identification confidence: Low/);
assert.match(await page.innerText('body'), /Grade confidence: Low/);
await page.getByRole('button', { name: /Accept candidate \(No Grade\)/ }).click();
assert.equal(await page.getByTestId('decision-recorded').count(), 0);
await page.getByRole('button', { name: 'Cannot confirm it is No. 62' }).click();
await page.getByTestId('decision-recorded').waitFor();
s = await state();
assert.equal(s.decisions['play-3'].action, 'accepted');
assert.deepEqual(s.decisions['play-3'].reasonCodes, ['identity_unresolved']);
ok('identification and grade confidence are shown separately; accepting No Grade needs a reason');
await backToQueue();

// --- Play 4: blind first ----------------------------------------------------
await openPlay(4);
assert.equal(await page.getByRole('heading', { name: 'Simulated AI candidate' }).count(), 0);
await page.getByRole('button', { name: 'Grade 2', exact: true }).click();
await page.getByRole('button', { name: /Submit my grade and reveal/ }).click();
await page.getByRole('heading', { name: 'Simulated AI candidate' }).waitFor();
await page.getByRole('button', { name: 'Change to Grade 2' }).click();
await page.getByRole('button', { name: 'Hand placement', exact: true }).click();
await page.getByTestId('decision-recorded').waitFor();
s = await state();
assert.equal(s.blindGrades['play-4'], 2);
assert.equal(s.decisions['play-4'].blindGrade, 2);
assert.equal(s.decisions['play-4'].candidateGrade, 1);
assert.equal(s.decisions['play-4'].finalGrade, 2);
assert.equal(s.decisions['play-4'].movedTowardCandidate, false);
ok('blind grade, candidate and final grade are stored separately');
await backToQueue();

// --- Play 5 -----------------------------------------------------------------
await openPlay(5);
await page.getByRole('button', { name: /Accept candidate \(Grade 2\)/ }).click();
await page.getByTestId('decision-recorded').waitFor();
await backToQueue();

// --- Play 6: degraded film -------------------------------------------------
await openPlay(6);
assert.match(await page.innerText('body'), /Film quality: Poor/);
assert.match(
  await page.getByTestId('would-enable').innerText(),
  /end-zone copy of this snap, or any fixed angle without the zoom push/,
);
ok('the degraded snap abstains and says what would make it gradable');
await page.screenshot({ path: `${OUT}/05d-degraded.png`, fullPage: true });
await page.getByRole('button', { name: /Accept candidate \(No Grade\)/ }).click();
await page.getByRole('button', { name: 'Film quality too poor' }).click();
await page.getByTestId('decision-recorded').waitFor();
await page.getByRole('button', { name: 'Continue to practice focus' }).click();

// --- Screen 6: practice focus -----------------------------------------------
await page.getByRole('heading', { name: 'Practice focus' }).waitFor();
assert.match(
  await page.getByTestId('focus-title').innerText(),
  /Hand placement during initial engagement/,
);
assert.equal(
  await page.getByTestId('coverage-statement').innerText(),
  'Coverage: Based on 4 coach-graded plays of 6 reviewed. Play 3, Play 6 were No Grade and are not included.',
);
ok('practice focus excludes No Grade plays and states coverage');
await page.screenshot({ path: `${OUT}/06-practice-focus.png`, fullPage: true });
await page.getByRole('button', { name: 'Accept', exact: true }).click();
await page.waitForFunction(
  () => JSON.parse(localStorage.getItem('footballos.prototype.v2')).recommendationState === 'accepted',
);
// Invalidation: change a decision after accepting the focus, then come back.
await page.getByRole('button', { name: 'Back to queue' }).click();
await openPlay(5);
await page.getByRole('button', { name: 'Change to Grade 1' }).click();
await page.getByRole('button', { name: 'Pad level or leverage' }).click();
await page.getByTestId('decision-recorded').waitFor();
s = await state();
assert.equal(s.recommendationState, 'stale');
await page.getByRole('button', { name: 'Continue to practice focus' }).click();
await page.getByTestId('focus-stale').waitFor();
await page.getByRole('button', { name: 'Accept', exact: true }).click();
ok('a decision change invalidates the accepted practice focus and requires renewed review');
await page.getByRole('button', { name: 'Continue to research questions' }).click();

// --- Screen 7: research summary ---------------------------------------------
await page.getByRole('heading', { name: 'Research questions' }).waitFor();
assert.match(await page.getByTestId('baseline-readonly').innerText(), /20 minutes/);
assert.equal(
  await page.getByText(/how long does it normally take you to grade five/i).count(),
  0,
);
ok('baseline is shown read-only and never re-asked');

for (const name of [
  'Was the evidence easy to understand?',
  'Were the confidence readings and No Grade understandable?',
]) {
  await page.getByRole('group', { name }).getByRole('radio', { name: 'Yes' }).click();
}
await page.getByRole('radio', { name: '4' }).click();
await page.getByRole('button', { name: 'Submit feedback' }).click();
await page.waitForFunction(
  () => JSON.parse(localStorage.getItem('footballos.prototype.v2')).feedback?.trustRating === 4,
);
assert.match(await page.getByTestId('summary-coverage').innerText(), /4 graded · 2 No Grade/);
assert.match(await page.getByTestId('summary-changed').innerText(), /Hand placement × 2/);
assert.match(await page.getByTestId('timing-comparison').innerText(), /Exploratory comparison/);
assert.match(
  await page.getByTestId('blind-comparison').innerText(),
  /Coach first: Grade 2 · System candidate: Grade 1 · Final: Grade 2/,
);
ok('session summary reports coverage, reason breakdown and the blind comparison');

// JSON download
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Download Session JSON' }).click(),
]);
const path = await download.path();
const json = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'));
assert.equal(json.summary.playsGraded, 4);
assert.equal(json.summary.playsNoGrade, 2);
assert.equal(json.filmLinkHost, 'www.youtube.com');
assert.ok(!JSON.stringify(json).includes('v=example'));
assert.match(json.accuracy, /not evaluated/);
assert.equal(json.baseline.capturedBeforeReviewTask, true);
assert.equal(json.timingSchema, 'accumulated_v1');
assert.ok(Array.isArray(json.events) && json.events.length > 10);
ok('session results serialize to JSON');
await page.screenshot({ path: `${OUT}/07-summary.png`, fullPage: true });

// --- responsive + console health --------------------------------------------
for (const [w, h, label] of [
  [1024, 768, 'tablet-landscape'],
  [768, 1024, 'tablet-portrait'],
  [1440, 900, 'desktop'],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(120);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 2) problems.push(`horizontal overflow at ${label}: ${overflow}px`);
}
ok('no horizontal overflow at 768, 1024 and 1440 widths');

if (consoleErrors.length) problems.push(`console errors: ${consoleErrors.join(' | ')}`);

await browser.close();

if (problems.length) {
  console.error('\nFAILURES:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('\nAll end-to-end checks passed.');
