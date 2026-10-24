import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Play } from '../types';
import { PlayDiagram } from './PlayDiagram';
import { DEMO_FILM_CREDIT, DEMO_FILM_PHASE_SECONDS } from '../data/demoFilm';

/** Footage available for the stage: the bundled demo clip or a coach-selected local file. */
export interface FilmVideo {
  url: string;
  kind: 'demo' | 'local';
}

const PHASE_LABEL = {
  presnap: 'Pre-snap',
  first_step: 'First step',
  contact: 'Contact',
  result: 'Result',
} as const;

function toSeconds(ts: string): number {
  const [mm, ss] = ts.split(':');
  return Number(mm) * 60 + Number(ss);
}

/**
 * Film stage. Shows real footage when there is any — the bundled, openly licensed
 * demo clip or the coach's own local file (played in the browser, never uploaded or
 * analyzed) — with the illustrative storyboard diagram one toggle away. Frame
 * selection is real: it changes the diagram, highlights the matching evidence, and
 * seeks the video to the matching moment.
 */
export function FilmStage({
  play,
  video,
  revealed,
  frame,
  onFrameChange,
}: {
  play: Play;
  video: FilmVideo | null;
  /** On the blind-first play the candidate's evidence labels are withheld until the coach grades. */
  revealed: boolean;
  frame: number;
  onFrameChange: (index: number) => void;
}) {
  const frames = play.storyboard;
  const current = frames[frame] ?? frames[0];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState<'footage' | 'diagram'>('footage');
  const showVideo = video !== null && view === 'footage';

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !video) return;
    try {
      v.currentTime =
        video.kind === 'demo' ? DEMO_FILM_PHASE_SECONDS[current.phase] : toSeconds(current.timestamp);
    } catch {
      /* not seekable yet */
    }
  }, [current.phase, current.timestamp, video, showVideo]);

  const evidenceForFrame = revealed
    ? play.observedEvidence.find((e) => e.frame === frame) ?? null
    : null;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' && frame < frames.length - 1) {
      e.preventDefault();
      onFrameChange(frame + 1);
    } else if (e.key === 'ArrowLeft' && frame > 0) {
      e.preventDefault();
      onFrameChange(frame - 1);
    }
  }

  const tierClass =
    play.filmQuality.tier === 'Good' ? 'high' : play.filmQuality.tier === 'Fair' ? 'medium' : 'low';

  return (
    <section className="card stage-card" aria-labelledby="film-heading">
      <div className="card-head">
        <h2 id="film-heading">
          Play {play.playNumber} — {play.quarter} {play.gameClock} · {play.situation}
        </h2>
        <span className="tag">{play.concept}</span>
      </div>

      {video && (
        <div className="btn-row stage-toggle" role="group" aria-label="Stage view">
          <button
            type="button"
            className={view === 'footage' ? 'primary' : ''}
            aria-pressed={view === 'footage'}
            onClick={() => setView('footage')}
          >
            Footage
          </button>
          <button
            type="button"
            className={view === 'diagram' ? 'primary' : ''}
            aria-pressed={view === 'diagram'}
            onClick={() => setView('diagram')}
          >
            Play diagram
          </button>
        </div>
      )}

      <div className="stage">
        {showVideo && video ? (
          <video
            ref={videoRef}
            src={video.url}
            controls
            playsInline
            preload="metadata"
            data-testid="film-video"
            aria-label={
              video.kind === 'demo'
                ? 'Demo game film: one real end-zone run, shown as illustration'
                : 'Coach-selected local film (plays in this browser only)'
            }
          />
        ) : (
          <PlayDiagram play={play} frameIndex={frame} />
        )}
      </div>

      <p className="stage-label" data-testid="stage-label">
        {showVideo && video?.kind === 'demo' ? (
          <>
            <strong>Real game film, shown as illustration.</strong> One end-zone run from
            openly licensed college game film, shown for every demo play. The simulated
            evaluation on this screen describes the authored demo play, not this footage, and
            nothing in the clip was analyzed.{' '}
            <span className="film-credit">
              Film: {DEMO_FILM_CREDIT.title},{' '}
              <a href={DEMO_FILM_CREDIT.sourceUrl} target="_blank" rel="noreferrer">
                {DEMO_FILM_CREDIT.holder}
              </a>
              ,{' '}
              <a href={DEMO_FILM_CREDIT.licenseUrl} target="_blank" rel="noreferrer">
                {DEMO_FILM_CREDIT.license}
              </a>
              ; {DEMO_FILM_CREDIT.changes}.
            </span>
          </>
        ) : showVideo ? (
          <>
            <strong>Your local file.</strong> It plays here only. The simulated evaluation on
            this screen describes the authored demo play, not this file.
          </>
        ) : (
          <>
            <strong>Illustrative play diagram.</strong> A schematic drawn from authored data
            &mdash; not footage, not tracking output, and not evidence of model performance.
          </>
        )}
      </p>

      <div
        className="frame-controls"
        role="group"
        aria-label="Frame selection"
        onKeyDown={onKey}
      >
        <button
          type="button"
          onClick={() => onFrameChange(frame - 1)}
          disabled={frame <= 0}
          aria-label="Previous frame"
        >
          ‹ Prev
        </button>
        <ol className="frame-list">
          {frames.map((f, i) => {
            const hasEvidence = revealed && play.observedEvidence.some((e) => e.frame === i);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  className={`frame-btn${i === frame ? ' selected' : ''}`}
                  aria-pressed={i === frame}
                  onClick={() => onFrameChange(i)}
                >
                  <span className="frame-phase">{PHASE_LABEL[f.phase]}</span>
                  <span className="mono small">{f.timestamp}</span>
                  {hasEvidence && (
                    <span className="frame-evidence" title="Candidate evidence at this frame">
                      <span aria-hidden="true">E</span>
                      <span className="sr-only">Evidence frame</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={() => onFrameChange(frame + 1)}
          disabled={frame >= frames.length - 1}
          aria-label="Next frame"
        >
          Next ›
        </button>
      </div>

      <p className="frame-caption" aria-live="polite" data-testid="frame-caption">
        <span className="mono small">{current.timestamp}</span>{' '}
        {evidenceForFrame ? (
          <>
            <span className="tag gold">Candidate evidence</span> {evidenceForFrame.label}
          </>
        ) : (
          current.neutralCaption
        )}
      </p>

      <div className="btn-row film-quality">
        <span className={`tag ${tierClass}`}>Film quality: {play.filmQuality.tier}</span>
        {play.filmQuality.issues.map((issue) => (
          <span className="small muted" key={issue}>
            {issue}
          </span>
        ))}
      </div>
      {!revealed && (
        <p className="small muted" style={{ marginTop: 6 }}>
          The candidate&rsquo;s evidence markers are withheld until you record your own grade.
        </p>
      )}
    </section>
  );
}
