import { useEffect, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { PLAYS } from '../data/plays';
import {
  CONFIDENCE_DISCLAIMER,
  CONFIDENCE_MEANING,
  GRADE_DEFINITIONS,
  NO_GRADE_CALLOUT,
  TEAM,
  gradeLabel,
  gradeShort,
} from '../data/team';
import { COURSE_LINE, DOC_URLS, REPO_URL } from '../data/links';
import { AccuracyNote, ConfidenceTag, GradeBadge } from '../components/Indicators';
import { EvidencePanel } from '../components/EvidencePanel';
import { PlayDiagram } from '../components/PlayDiagram';

/**
 * Grader-facing landing page. Everything shown in "How the AI output is presented" is
 * rendered by the same components the workflow uses, from the same seeded data — no
 * screenshots and no copy that could drift from the product. The simulated nature of the
 * AI is stated above the fold in the same register as the global banner.
 */

const LOOP_STEPS = [
  { n: 1, label: 'Select film', detail: 'Demo film, a local file, or a link (host only).' },
  { n: 2, label: 'Inspect the candidate', detail: 'A proposed grade with its rationale.' },
  { n: 3, label: 'Check evidence and uncertainty', detail: 'Frame-linked evidence; what is missing.' },
  { n: 4, label: 'Accept, change, or No Grade', detail: 'Every change and every No Grade needs a reason.' },
  { n: 5, label: 'Build the practice focus', detail: 'From coach-approved findings only.' },
];

const SIMULATED: string[] = [
  'Every candidate grade, rationale, evidence timestamp, uncertainty note, confidence label and film-quality read is hand-authored data in the repository.',
  'The play diagram is an illustrative schematic drawn from that data. It is not footage, not tracking output, and not evidence of model performance.',
  'The pre-review film check and the staged "processing" steps are authored. No file is inspected.',
  'A local video you choose plays in your browser only. It is never uploaded, transmitted or analyzed, and the evaluation shown still describes the authored demo play.',
  'Confidence labels are authored, illustrative values, not calibrated probabilities. Model accuracy was not evaluated.',
];

const REAL: string[] = [
  'The decisions you make: accept, change with a reason, or No Grade with a reason. Each is saved with a revision count and a review time.',
  'Frame selection: picking an evidence item changes the diagram and the caption.',
  'The blind-first probe on Play 4: the candidate stays hidden until you record your own grade, and both are stored separately.',
  'The practice focus is composed deterministically from your decisions only, and it is marked stale if you change a decision afterwards.',
  'The research instrumentation: a baseline captured before the review task (research entry), accumulated per-play review timing, structured reasons, feedback questions, and a JSON export that stays in this browser.',
];

export function LandingScreen() {
  const { state, dispatch } = useSession();
  const resumable = state.resumeScreen !== null;
  const [confirm, setConfirm] = useState<'demo' | 'research' | null>(null);

  // The landing page shows example candidates, confidence labels and evidence. Record that
  // it was seen so a research baseline captured afterwards carries that exposure.
  useEffect(() => {
    dispatch({ type: 'markLandingViewed' });
  }, [dispatch]);

  // Live examples: one Grade 2 snap for the candidate, confidence and evidence cards; one
  // abstention for the No Grade card. Both are the real seeded plays from `plays.ts`.
  const graded = PLAYS.find((p) => p.candidateGrade === 2) ?? PLAYS[1];
  const abstained = PLAYS.find((p) => p.candidateGrade === 'NG' && p.filmQuality.degraded) ?? PLAYS[5];
  const [frame, setFrame] = useState<number>(graded.observedEvidence[0]?.frame ?? 0);
  const evidenceAtFrame = graded.observedEvidence.find((e) => e.frame === frame) ?? null;
  const currentFrame = graded.storyboard[frame] ?? graded.storyboard[0];

  function start(kind: 'demo' | 'research') {
    if (resumable && confirm !== kind) {
      setConfirm(kind);
      return;
    }
    setConfirm(null);
    if (kind === 'demo') dispatch({ type: 'startDemo' });
    else dispatch({ type: 'startResearch', via: 'landing_page' });
  }

  return (
    <>
      {/* 1. Hero */}
      <section className="hero landing-hero" aria-labelledby="landing-heading">
        <h1 id="landing-heading">FootballOS</h1>
        <p className="lede">
          An AI-assisted film-review workspace for high-school position coaches who turn game
          film into graded, teachable findings. The system prepares the evidence and proposes
          a grade. The coach decides.
        </p>

        {resumable && (
          <div className="callout gold landing-resume" data-testid="landing-resume">
            <strong>You have a saved session in this browser.</strong>{' '}
            {state.mode === 'demo' ? 'It is a demo session.' : 'It is a research session.'}{' '}
            Starting a new session replaces it.
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="primary"
                onClick={() => dispatch({ type: 'resume' })}
              >
                Resume your session
              </button>
            </div>
          </div>
        )}

        <div className="btn-row landing-cta">
          <button
            type="button"
            className="cta-primary"
            onClick={() => start('demo')}
            aria-describedby="honesty-line"
          >
            Try the demo (about 5 minutes)
          </button>
          <button type="button" className="cta-secondary" onClick={() => start('research')}>
            Start a research session
          </button>
        </div>
        {confirm && (
          <div className="callout warn landing-confirm" role="status">
            This replaces the saved session in this browser. Export it first from the results
            screen if you want to keep it.
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className="danger" onClick={() => start(confirm)}>
                {confirm === 'demo' ? 'Yes, start a new demo' : 'Yes, start a new research session'}
              </button>
              <button type="button" onClick={() => setConfirm(null)}>
                Keep my session
              </button>
            </div>
          </div>
        )}

        <p className="honesty-line" id="honesty-line" data-testid="honesty-line">
          <strong>Simulated AI.</strong> No video is processed and no model is called. Every
          grade, confidence label and evidence note is authored data about a fictional program,
          the {TEAM.program}. Nothing you do here leaves this browser.
        </p>
      </section>

      {/* 2. How a coach uses it */}
      <section className="card" aria-labelledby="loop-heading">
        <h2 id="loop-heading">How a coach uses it</h2>
        <p className="small muted">One review loop, five steps. The demo walks all five.</p>
        <ol className="landing-steps" aria-label="The coaching loop">
          {LOOP_STEPS.map((s) => (
            <li key={s.n} className="step">
              <span className="landing-step-label">
                {s.n}. {s.label}
              </span>
              <span className="small muted">{s.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* 3. How the AI output is presented */}
      <section className="card" aria-labelledby="output-heading">
        <div className="card-head">
          <h2 id="output-heading">How the AI output is presented</h2>
          <span className="tag gold">Live components · seeded data · simulated</span>
        </div>
        <p className="small muted">
          These four cards are the product&rsquo;s own components rendering Play {graded.playNumber}{' '}
          and Play {abstained.playNumber} from the demo. They are not screenshots. <AccuracyNote inline />
        </p>

        <div className="landing-grid-2">
          {/* 3a. Candidate grade with rationale */}
          <article className="card tight landing-example" aria-labelledby="ex-grade">
            <h3 id="ex-grade">Candidate grade with rationale</h3>
            <div className="card-head">
              <span className="small">
                <strong>Simulated AI candidate</strong> · Play {graded.playNumber}, {graded.quarter}{' '}
                {graded.gameClock}
              </span>
              <GradeBadge value={graded.candidateGrade} large />
            </div>
            <p>
              <strong>{gradeLabel(graded.candidateGrade)}.</strong> {graded.rationale}
            </p>
            <h4>The scale</h4>
            <dl className="scale-list">
              {GRADE_DEFINITIONS.map((g) => (
                <div key={String(g.value)} className="scale-row">
                  <dt>
                    <GradeBadge value={g.value} />
                  </dt>
                  <dd>
                    <strong>{g.short}.</strong> {g.definition}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="why-note">
              <strong>Why:</strong> rationale before assertion, so the coach can judge the claim
              rather than defer to it &mdash; Weisz et al. (2024), design for appropriate trust
              and reliance.
            </p>
          </article>

          {/* 3b. Two confidence readings */}
          <article className="card tight landing-example" aria-labelledby="ex-confidence">
            <h3 id="ex-confidence">Two confidence readings, kept separate</h3>
            <ul className="evidence-list">
              <li>
                <span className="ts">ID</span>
                <span>
                  <ConfidenceTag kind="ID" band={graded.idConfidence} />
                  <br />
                  <span className="small muted">
                    How sure the system is that this is {graded.playerNumber}.{' '}
                    {CONFIDENCE_MEANING[graded.idConfidence]}
                  </span>
                </span>
              </li>
              <li>
                <span className="ts">Grade</span>
                <span>
                  <ConfidenceTag kind="Grade" band={graded.gradeConfidence} />
                  <br />
                  <span className="small muted">
                    How sure the system is about the evaluation itself.{' '}
                    {CONFIDENCE_MEANING[graded.gradeConfidence]}
                  </span>
                </span>
              </li>
            </ul>
            <p className="small">
              The two readings answer different questions, so they are never merged into one
              score. A wrong player with a confident grade is still wrong. Bands are High, Medium
              or Low with a glyph (●●○) so the band never depends on colour, and there is no
              percentage: a number would read as accuracy, and accuracy has not been evaluated.
            </p>
            <p className="small muted">{CONFIDENCE_DISCLAIMER}</p>
            <p className="why-note">
              <strong>Why:</strong> make uncertainty visible without implying precision &mdash;
              Weisz et al. (2024), design for imperfection; Zieglmeier &amp; Lehene (2022),
              transparency about limitations.
            </p>
          </article>

          {/* 3c. Evidence you can inspect */}
          <article className="card tight landing-example landing-example-wide" aria-labelledby="ex-evidence">
            <h3 id="ex-evidence">Evidence you can inspect</h3>
            <div className="landing-evidence">
              <div>
                <div className="stage">
                  <PlayDiagram play={graded} frameIndex={frame} />
                </div>
                <p className="frame-caption" aria-live="polite" data-testid="landing-frame-caption">
                  <span className="mono small">{currentFrame.timestamp}</span>{' '}
                  {evidenceAtFrame ? (
                    <>
                      <span className="tag gold">Candidate evidence</span> {evidenceAtFrame.label}
                    </>
                  ) : (
                    currentFrame.neutralCaption
                  )}
                </p>
                <p className="stage-label">
                  <strong>Illustrative play diagram.</strong> A schematic drawn from authored data
                  &mdash; not footage, not tracking output, and not evidence of model performance.
                </p>
              </div>
              <EvidencePanel play={graded} frame={frame} onFrameChange={setFrame} headingLevel={3} />
            </div>
            <p className="why-note">
              <strong>Why:</strong> each evidence item is linked to a frame so the claim can be
              checked rather than taken on faith &mdash; Weisz et al. (2024), calibrate trust
              using explanations.
            </p>
          </article>

          {/* 3d. When the system declines to grade */}
          <article className="card tight landing-example landing-example-wide" aria-labelledby="ex-nograde">
            <h3 id="ex-nograde">When the system declines to grade</h3>
            <div className="landing-grid-2">
              <div>
                <div className="card-head">
                  <span className="small">
                    <strong>Simulated AI candidate</strong> · Play {abstained.playNumber},{' '}
                    {abstained.quarter} {abstained.gameClock}
                  </span>
                  <GradeBadge value={abstained.candidateGrade} large />
                </div>
                <p>
                  <strong>{gradeLabel(abstained.candidateGrade)}.</strong> {abstained.rationale}
                </p>
                <div className="btn-row film-quality">
                  <span className="tag low">Film quality: {abstained.filmQuality.tier}</span>
                  {abstained.filmQuality.issues.map((issue) => (
                    <span className="small muted" key={issue}>
                      {issue}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                {abstained.filmQuality.wouldEnable && (
                  <div className="callout" data-testid="landing-would-enable">
                    <strong>What would make this gradable:</strong>{' '}
                    {abstained.filmQuality.wouldEnable}
                  </div>
                )}
                <div className="callout">{NO_GRADE_CALLOUT}</div>
                <p className="small muted">
                  Accepting a {gradeShort('NG')} still asks the coach for a reason, and coverage
                  (reviewed · graded · No Grade) is shown wherever a result is shown, so an
                  abstention is counted, not hidden.
                </p>
              </div>
            </div>
            <p className="why-note">
              <strong>Why:</strong> abstention is a feature, not an error. Saying &ldquo;not
              enough evidence&rdquo; with a remedy beats a confident guess &mdash; Weisz et al.
              (2024), design for imperfection.
            </p>
          </article>
        </div>
      </section>

      {/* 4. How you stay in control */}
      <section className="card" aria-labelledby="control-heading">
        <h2 id="control-heading">How you stay in control</h2>
        <div className="landing-grid-3">
          <div className="card tight">
            <h3>Two interactions to correct, with a reason</h3>
            <p className="small">
              Pick the grade, pick one structured reason. The decision is not saved until the
              reason is picked, and the screen says &ldquo;Not saved yet.&rdquo; The original
              candidate stays visible.
            </p>
          </div>
          <div className="card tight">
            <h3>Play 4 asks for your grade first</h3>
            <p className="small">
              On one play the candidate, its rationale, confidence and evidence markers are
              withheld until you record your own grade. Your grade, the candidate and your final
              decision are stored separately.
            </p>
          </div>
          <div className="card tight">
            <h3>A changed decision marks the focus stale</h3>
            <p className="small">
              The practice focus is built only from your approved decisions. If you change a
              decision after reviewing it, the focus is marked stale and asks for another look
              instead of being silently rewritten.
            </p>
          </div>
        </div>
      </section>

      {/* 5. What is simulated and what is not */}
      <section className="card" aria-labelledby="sim-heading">
        <h2 id="sim-heading">What is simulated and what is not</h2>
        <div className="landing-grid-2">
          <div>
            <h3>Simulated</h3>
            <ul className="small">
              {SIMULATED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Real, in this prototype</h3>
            <ul className="small">
              {REAL.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          There is no computer vision, no model call, no backend and no network request at
          runtime. <AccuracyNote inline />
        </p>
      </section>

      {/* 6. Usability testing */}
      <section className="card" aria-labelledby="testing-heading">
        <h2 id="testing-heading">Usability testing</h2>
        <p>
          The prototype is instrumented for a formative study: a baseline estimate captured on
          the research entry page before the review task (with known prior exposure recorded
          next to it), accumulated per-play review timing, structured correction and No Grade
          reasons, feedback questions, and a JSON export that stays in the browser. Research
          participants are sent straight to the research entry link, not to this page. A
          protocol for a first round with three to five high-school coaches is written. No study
          has been run yet, and no findings are claimed.
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          <a href={DOC_URLS.protocol} target="_blank" rel="noreferrer">
            Read the usability test protocol on GitHub
          </a>
        </p>
      </section>

      {/* 7. Footer */}
      <footer className="landing-footer" aria-label="About this prototype">
        <ul>
          <li>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
          </li>
          <li>
            <a href={DOC_URLS.rationale} target="_blank" rel="noreferrer">
              Design rationale (Module 7)
            </a>
          </li>
          <li>
            <a href={DOC_URLS.aiUse} target="_blank" rel="noreferrer">
              AI-use disclosure
            </a>
          </li>
        </ul>
        <p className="small muted">
          {TEAM.program} is a fictional program; {TEAM.primaryPlayer} is a fictional player.
          No real player, coach or school appears anywhere in this prototype.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {COURSE_LINE}
        </p>
      </footer>
    </>
  );
}
