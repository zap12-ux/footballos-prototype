import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { DEMO_FILM_LABEL, PROCESSING_STEPS } from '../data/plays';
import { setLocalFilmUrl } from '../utils/localFilm';
import { DEMO_FILM_CREDIT } from '../data/demoFilm';
import { buildFilmCheck } from '../utils/filmCheck';

const STEP_MS = import.meta.env.MODE === 'test' ? 15 : 750;

function isVideoFile(file: File): boolean {
  if (file.type && file.type.startsWith('video/')) return true;
  return /\.(mp4|mov|m4v|webm)$/i.test(file.name);
}

function validLink(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function FilmScreen() {
  const { state, dispatch } = useSession();
  const [dragOver, setDragOver] = useState(false);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [link, setLink] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const filmCheck = useMemo(() => buildFilmCheck(), []);

  const processing = stepIndex !== null;

  useEffect(() => {
    if (stepIndex === null) return;
    if (stepIndex >= PROCESSING_STEPS.length) {
      dispatch({ type: 'log', event: 'processing_completed' });
      dispatch({ type: 'goto', screen: 'queue' });
      return;
    }
    const t = setTimeout(() => setStepIndex((i) => (i === null ? null : i + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [stepIndex, dispatch]);

  function startDemo() {
    setFileError(null);
    dispatch({ type: 'selectFilm', source: 'demo', label: DEMO_FILM_LABEL });
    setStepIndex(0);
  }

  function handleLocalFile(file: File) {
    if (!isVideoFile(file)) {
      setFileError(
        `“${file.name}” is not a video file (${file.type || 'unknown type'}). Choose an MP4, MOV, M4V or WebM file, or use the demo film.`,
      );
      dispatch({ type: 'log', event: 'local_file_rejected', data: { type: file.type || 'unknown' } });
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFileError(null);
    if (typeof URL.createObjectURL === 'function') {
      try {
        setLocalFilmUrl(URL.createObjectURL(file));
      } catch {
        setLocalFilmUrl(null);
      }
    }
    dispatch({
      type: 'selectFilm',
      source: 'local',
      label: `Local file selected in this browser (${file.name})`,
    });
    setStepIndex(0);
  }

  function recordLink() {
    const value = link.trim();
    if (!validLink(value)) {
      setLinkError('Enter a full web address that starts with http:// or https://.');
      return;
    }
    setLinkError(null);
    dispatch({ type: 'recordFilmLink', url: value });
    setLink('');
  }

  function cancelProcessing() {
    setStepIndex(null);
    dispatch({ type: 'log', event: 'processing_cancelled' });
  }

  return (
    <>
      <section className="card">
        <h1>Select film</h1>
        <p className="small muted">
          Use the demo film for this session. You may also point at a local file to see how
          selection would feel &mdash; the prototype will not analyze it.
        </p>

        <div className="two-col">
          <div>
            <div className="card tight" style={{ margin: '0 0 16px' }}>
              <h2>Use Demo Film</h2>
              <p className="small">{DEMO_FILM_LABEL}</p>
              <p className="small muted">
                {filmCheck.totalPlays} offensive-line snaps with prepared, simulated review
                candidates. This is the recommended path for the session.
              </p>
              <button type="button" className="primary" onClick={startDemo} disabled={processing}>
                Use Demo Film
              </button>
              <p className="small muted film-credit" data-testid="demo-film-credit" style={{ marginTop: 10, marginBottom: 0 }}>
                Footage: six real end-zone snaps from {DEMO_FILM_CREDIT.title},{' '}
                <a href={DEMO_FILM_CREDIT.sourceUrl} target="_blank" rel="noreferrer">
                  {DEMO_FILM_CREDIT.holder}
                </a>
                , licensed{' '}
                <a href={DEMO_FILM_CREDIT.licenseUrl} target="_blank" rel="noreferrer">
                  {DEMO_FILM_CREDIT.license}
                </a>
                ; {DEMO_FILM_CREDIT.changes}. The footage is shown as illustration, one clip per
                play, and is not analyzed.
              </p>
            </div>

            <div className="card tight" style={{ margin: 0 }}>
              <div className="card-head">
                <h2>Film check</h2>
                <span className="tag">Before you start · simulated</span>
              </div>
              <p data-testid="film-check-statement" style={{ marginBottom: 8 }}>
                {filmCheck.statement}
              </p>
              <h4>What we would flag on this film</h4>
              <ul className="small" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {filmCheck.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <p className="small muted" style={{ marginBottom: 0 }}>
                Gradeability is judged per position, not per file &mdash; a snap that will not
                support interior line work may still be fine for quarterback or for formation
                tendencies. This forecast is authored for the prototype; no file is inspected.
              </p>
            </div>
          </div>

          <div>
            <div
              className={`dropzone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer?.files?.[0];
                if (file) handleLocalFile(file);
              }}
            >
              <p style={{ marginBottom: 8 }}>
                <strong>Drag and drop game film here</strong>
              </p>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={processing}>
                Choose a file
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/*"
                className="sr-only"
                aria-label="Choose a local film file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLocalFile(file);
                }}
              />
              <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                MP4, MOV, M4V or WebM. The file plays in your browser only and is never uploaded
                or analyzed. The demo evaluations describe the authored demo plays, not your file.
              </p>
              {fileError && (
                <p role="alert" className="field-error" data-testid="file-error">
                  {fileError}
                </p>
              )}
            </div>
            <div className="callout">
              Privacy: nothing you select here leaves this browser. No file, link, or frame is
              transmitted anywhere.
            </div>

            <div className="card tight" style={{ margin: 0 }}>
              <h3>Or paste a link to the game</h3>
              <p className="small muted">
                If your program streams games, paste the link. This records that you would use a
                link here &mdash; an intake preference. The prototype does not open, fetch, or
                analyze the video, and it keeps only the site name (host), not the link itself.
              </p>
              <label htmlFor="film-link">Video link (optional)</label>
              <div className="btn-row">
                <input
                  id="film-link"
                  type="text"
                  inputMode="url"
                  style={{ flex: 1, minWidth: 220 }}
                  placeholder="https://…"
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value);
                    if (linkError) setLinkError(null);
                  }}
                  aria-invalid={linkError ? 'true' : undefined}
                  aria-describedby={linkError ? 'link-error' : undefined}
                />
                <button type="button" disabled={!link.trim() || processing} onClick={recordLink}>
                  Record this link
                </button>
              </div>
              {linkError && (
                <p id="link-error" role="alert" className="field-error">
                  {linkError}
                </p>
              )}
              {state.filmLinkHost && (
                <p className="small" data-testid="link-recorded" style={{ marginTop: 8 }}>
                  Link noted (site: <span className="mono">{state.filmLinkHost}</span>). Nothing
                  was fetched and the full link was not stored. In a production system a link
                  would only be used with the program&rsquo;s permission and through the
                  platform&rsquo;s own authorized access.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {processing && (
        <section className="card" aria-live="polite" aria-busy="true">
          <div className="card-head">
            <h2>Preparing film</h2>
            <span className="tag gold">Simulated processing</span>
          </div>
          <p className="small muted">
            Nothing is being analyzed &mdash; these steps are staged so the walkthrough shows
            what a coach would see while waiting.
          </p>
          {PROCESSING_STEPS.map((label, i) => (
            <div
              key={label}
              className={`processing-step${stepIndex !== null && i < stepIndex ? ' done' : ''}${
                stepIndex === i ? ' active' : ''
              }`}
            >
              <span className="dot" aria-hidden="true" />
              <span>
                {label}
                {stepIndex !== null && i < stepIndex ? ' — complete' : ''}
                {stepIndex === i ? ' — in progress' : ''}
              </span>
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 8 }}>
            Selected: {state.filmLabel}
          </p>
          <div className="btn-row">
            <button type="button" onClick={cancelProcessing}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </>
  );
}
