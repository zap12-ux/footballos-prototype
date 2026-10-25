import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { PlaySegment } from '../api/contracts';
import { StatusBadge, formatSeconds } from '../components/shell/ui';

export interface TimelineActions {
  onActivate: (segmentId: string) => void;
  onSeek: (segment: PlaySegment) => void;
  onAccept: (segment: PlaySegment) => void;
  onReject: (segment: PlaySegment) => void;
  onSplit: (segment: PlaySegment) => void;
  onMerge: (segment: PlaySegment) => void;
  onNextInQueue: () => void;
}

interface Props extends TimelineActions {
  segments: PlaySegment[];
  durationSec: number | null;
  activeId: string | null;
  /** Segments the coach is stepping through (proposed cuts, preselected by default). */
  queue: ReadonlySet<string>;
  currentTime: number;
  busy: boolean;
}

/** Where a cut came from; distinct from its review status so "Proposed" is not shown twice. */
export const ORIGIN_LABELS: Record<PlaySegment['origin'], string> = { proposed: 'Auto cut', coach_split: 'Coach split', coach_merged: 'Coach merged', coach_created: 'Coach created' };

/** Keyboard map (documented in the README). */
export const TIMELINE_KEYS: { key: string; action: string }[] = [
  { key: '↓ / →', action: 'Next play' },
  { key: '↑ / ←', action: 'Previous play' },
  { key: 'Home / End', action: 'First / last play' },
  { key: 'Enter or Space', action: 'Play from the start of this play' },
  { key: 'N', action: 'Next play still in the review queue' },
  { key: 'A', action: 'Accept this cut' },
  { key: 'R', action: 'Reject this cut' },
  { key: 'S', action: 'Split this play at the playhead' },
  { key: 'M', action: 'Merge this play with the next one' },
];

/**
 * Proposed/accepted/rejected plays on an overview track plus a single-tabstop listbox
 * (`aria-activedescendant`) that carries every keyboard interaction. Blocks on the track are
 * positioned by time with a minimum width so a 7-second play stays visible on a 2-hour file.
 */
export function SegmentTimeline({ segments, durationSec, activeId, queue, currentTime, busy, onActivate, onSeek, onAccept, onReject, onSplit, onMerge, onNextInQueue }: Props) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const ordered = [...segments].sort((a, b) => a.startSec - b.startSec);
  const active = ordered.find((s) => s.id === activeId) ?? null;
  const activeIndex = active ? ordered.indexOf(active) : -1;
  const duration = durationSec && durationSec > 0 ? durationSec : Math.max(1, ...ordered.map((s) => s.endSec));

  useEffect(() => {
    if (!activeId) return;
    const el = document.getElementById(`${id}-opt-${activeId}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, id]);

  function move(delta: number) {
    if (!ordered.length) return;
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + delta))];
    onActivate(next.id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        if (ordered[0]) onActivate(ordered[0].id);
        break;
      case 'End':
        e.preventDefault();
        if (ordered.length) onActivate(ordered[ordered.length - 1].id);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (active) onSeek(active);
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        onNextInQueue();
        break;
      case 'a':
      case 'A':
        e.preventDefault();
        if (active && !busy) onAccept(active);
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        if (active && !busy) onReject(active);
        break;
      case 's':
      case 'S':
        e.preventDefault();
        if (active && !busy) onSplit(active);
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        if (active && !busy) onMerge(active);
        break;
      default:
    }
  }

  const counts = { proposed: 0, accepted: 0, rejected: 0 };
  ordered.forEach((s) => (counts[s.reviewStatus] += 1));

  return (
    <section className="timeline" aria-labelledby={`${id}-h`}>
      <div className="timeline-head">
        <h3 id={`${id}-h`}>Plays ({ordered.length})</h3>
        <p className="small muted" data-testid="segment-counts">
          {counts.proposed} proposed · {counts.accepted} accepted · {counts.rejected} rejected · {queue.size} in the review queue. Times are seconds from the start of the original file.
        </p>
      </div>
      <div className="timeline-track" aria-hidden="true">
        {ordered.map((s) => (
          <span
            key={s.id}
            className={`tl-block ${s.reviewStatus}${s.id === activeId ? ' active' : ''}${queue.has(s.id) ? ' queued' : ''}`}
            style={{ left: `${(s.startSec / duration) * 100}%`, width: `${Math.max(0.35, ((s.endSec - s.startSec) / duration) * 100)}%` }}
            onClick={() => onActivate(s.id)}
          />
        ))}
        <span className="tl-playhead" style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }} />
      </div>
      <div className="timeline-actions btn-row">
        <button type="button" onClick={onNextInQueue} disabled={queue.size === 0}>
          Next in queue ({queue.size})
        </button>
        <button type="button" onClick={() => active && onSeek(active)} disabled={!active}>
          Play this cut
        </button>
        <button type="button" onClick={() => active && onAccept(active)} disabled={!active || busy || active.reviewStatus === 'accepted'}>
          Accept
        </button>
        <button type="button" onClick={() => active && onReject(active)} disabled={!active || busy || active.reviewStatus === 'rejected'}>
          Reject
        </button>
        <button type="button" onClick={() => active && onSplit(active)} disabled={!active || busy} title="Split at the playhead">
          Split at playhead
        </button>
        <button type="button" onClick={() => active && onMerge(active)} disabled={!active || busy || activeIndex === ordered.length - 1} title="Merge with the next play">
          Merge with next
        </button>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Plays on this film"
        aria-activedescendant={active ? `${id}-opt-${active.id}` : undefined}
        tabIndex={0}
        className="play-list"
        onKeyDown={onKeyDown}
        aria-describedby={`${id}-keys`}
      >
        {ordered.map((s, i) => (
          <div
            key={s.id}
            id={`${id}-opt-${s.id}`}
            role="option"
            aria-selected={s.id === activeId}
            className={`play-row${s.id === activeId ? ' active' : ''}`}
            onClick={() => onActivate(s.id)}
            onDoubleClick={() => onSeek(s)}
          >
            <span className="mono">#{i + 1}</span>
            <span className="mono">
              {formatSeconds(s.startSec)}–{formatSeconds(s.endSec)}
            </span>
            <span className="small muted">{(s.endSec - s.startSec).toFixed(1)} s</span>
            <span className="small">{ORIGIN_LABELS[s.origin]}</span>
            <span>
              <StatusBadge value={s.reviewStatus} />
              {s.reviewStatus === 'proposed' ? <span className={`chip-state ${queue.has(s.id) ? 'in-queue' : ''}`}>{queue.has(s.id) ? 'in review queue' : 'not queued'}</span> : null}
            </span>
          </div>
        ))}
      </div>
      <p id={`${id}-keys`} className="small muted keys-hint">
        Keyboard: {TIMELINE_KEYS.map((k) => `${k.key} ${k.action.toLowerCase()}`).join(' · ')}.
      </p>
    </section>
  );
}
