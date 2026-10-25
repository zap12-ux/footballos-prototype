import { Link } from 'react-router';
import { FocusOnNavigate } from '../app/FocusOnNavigate';
import { Montage } from '../components/shell/Montage';
import { DEMO_FILM_CLIPS, DEMO_FILM_CREDIT } from '../data/demoFilm';

const POSTER = `${import.meta.env.BASE_URL}landing/montage-poster.svg`;

const STEPS = [
  { title: 'Upload game film', body: 'Sideline or end-zone film goes into the game it belongs to. The upload asks four questions once: whose film, which unit, which camera, how to tell the teams apart.' },
  { title: 'Review proposed plays', body: 'Film is cut into proposed plays with timestamps you can check. Split, merge or reject a cut; the original is kept.' },
  { title: 'Correct the labels', body: 'Formation, play type and situation labels come with the frames the model looked at, a rationale and an explicit "not visible" when it could not tell. Your correction is the record.' },
  { title: 'Plan the week', body: 'Scouting counts show their denominators and whether unreviewed labels are included. Unit plans go from draft to coordinator approval; approved versions never change.' },
];

const TRUST = [
  { title: 'Counts you can check', body: 'Every tendency reads as a fraction: 19 of 54 reviewed snaps, with the snaps that were left out and why.' },
  { title: 'Unknown stays unknown', body: 'Down, distance, score and player identity are never guessed. If it is not on the film, the field stays empty.' },
  { title: 'Coaches approve', body: 'Extracted playbook concepts, roster edits and weekly plans are proposals until a coach approves them, and approvals are recorded.' },
  { title: 'Private by design', body: 'Invite-only staff accounts with multi-factor sign-in, team-scoped records, expiring media links, no public URLs.' },
];

export function LandingPage() {
  const clips = Object.values(DEMO_FILM_CLIPS).map((c) => c.src);
  return (
    <main id="main" tabIndex={-1} className="public-main pub-landing">
      <FocusOnNavigate title="FootballOS — game week, organized" />

      <section className="pub-hero" aria-labelledby="hero-heading">
        <div className="pub-hero-copy">
          <p className="eyebrow">For one football staff</p>
          <h1 id="hero-heading">Game film to game plan, with the coach in charge.</h1>
          <p className="lede">
            FootballOS is a private workspace where a coaching staff turns game film into reviewed scouting, weekly unit plans
            and a shared playbook. Software proposes play cuts and labels with its evidence attached; coaches correct, approve
            and own every decision.
          </p>
          <div className="btn-row">
            <Link to="/sign-in" className="btn primary large">
              Sign in
            </Link>
            <Link to={{ pathname: '/prototype/', hash: '#/demo' }} className="btn large">
              Try the demo
            </Link>
          </div>
          <p className="small muted">
            The demo is the film-review prototype: simulated evaluations on six real snaps, no account needed.
          </p>
        </div>
        <Montage
          clips={clips}
          poster={POSTER}
          credit={
            <>
              Footage: <em>{DEMO_FILM_CREDIT.title}</em>, {DEMO_FILM_CREDIT.holder},{' '}
              <a href={DEMO_FILM_CREDIT.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
              ,{' '}
              <a href={DEMO_FILM_CREDIT.licenseUrl} target="_blank" rel="noreferrer">
                {DEMO_FILM_CREDIT.license}
              </a>
              . Trimmed and re-encoded; audio removed.
            </>
          }
        />
      </section>

      <section className="pub-section" aria-labelledby="how-heading">
        <h2 id="how-heading">How a game week runs</h2>
        <ol className="step-grid">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pub-section" aria-labelledby="trust-heading">
        <h2 id="trust-heading">Built to be checked</h2>
        <div className="trust-grid">
          {TRUST.map((item) => (
            <article key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pub-section" aria-labelledby="scope-heading">
        <h2 id="scope-heading">What is in the workspace</h2>
        <ul className="scope-list">
          <li>
            <strong>Schedule</strong> — the season, imported or typed in, with results and the record computed from final scores.
          </li>
          <li>
            <strong>Our Team Film</strong> and <strong>Opponent Scouting</strong> — uploads, processing status, proposed plays, labels with evidence, tendencies with denominators.
          </li>
          <li>
            <strong>Weekly Game Plans</strong> — offense, defense and special teams sections, comments, coordinator approval, versions.
          </li>
          <li>
            <strong>Playbook</strong> and <strong>Personnel</strong> — concepts and terms extracted from your documents for approval; roster, depth chart and packages.
          </li>
          <li>
            <strong>Staff</strong> — roles by unit, invitations, retention settings. Head coaches run the team; everyone sees what their role allows.
          </li>
        </ul>
        <p className="small muted">
          Accounts are created by invitation from a team&rsquo;s head coach. There is no public sign-up.
        </p>
      </section>
    </main>
  );
}
