import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Play } from '../types';
import { PlayDiagram } from './PlayDiagram';

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
 * Film stage. Shows either the coach's own local file (played in the browser,
 * never uploaded or analyzed) or the illustrative storyboard diagram for the
 * play. Frame selection is real: it changes the diagram, highlights the
 * matching evidence, and seeks a local video to the same clip time.
 */
export function FilmStage({
  play,
  localVideoUrl,
  revealed,
  frame,
  onFrameChange,
}: {
  play: Play;
  localVideoUrl: string | null;
  /** On the blind-first play the candidate's evidence labels are withheld until the coach grades. */
  revealed: boolean;
  frame: number;
  onFrameChange: (index: number) => void;
}) {
  const frames = play.storyboard;
  const current = frames[frame] ?? frames[0];
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !localVideoUrl) return;
    try {
      v.currentTime = toSeconds(current.timestamp);
    } catch {
      /* not seekable yet */
    }
  }, [current.timestamp, localVideoUrl]);

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

      <div className="stage">
        {localVideoUrl ? (
          <video
            ref={videoRef}
            src={localVideoUrl}
            controls
            aria-label="Coach-selected local film (plays in this browser only)"
          />
        ) : (
          <PlayDiagram play={play} frameIndex={frame} />
        )}
      </div>

      <p className="stage-label">
        <strong>
          {localVideoUrl ? 'Your local file.' : 'Illustrative play diagram.'}
        </strong>{' '}
        {localVideoUrl
          ? 'It plays here only. The simulated evaluation on this screen describes the authored demo play, not this file.'
          : 'A schematic drawn from authored data — not footage, not tracking output, and not evidence of model performance.'}
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
