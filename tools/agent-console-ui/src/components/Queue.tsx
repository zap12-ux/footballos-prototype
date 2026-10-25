import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { QueueItem } from '../lib/derive';
import { trapTab } from '../lib/focus';
import type { QueueMode } from '../hooks/useLayoutMode';

interface Props {
  items: QueueItem[];
  onOpen: (agentId: string, questionId: string) => void;
  /** 'docked' = first grid column; 'collapsed' = a toggle bar plus an overlay list (D-2, below 960 px). */
  mode?: QueueMode;
  /** Collapsed mode only: whether the overlay list is open. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
}

export function Queue({ items, onOpen, mode = 'docked', open = false, onToggle }: Props) {
  const blocking = items.filter((i) => i.question.blocking).length;
  const collapsed = mode === 'collapsed';
  const showList = !collapsed || open;
  const panelRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const overlayOpen = collapsed && open;

  // Overlay list: focus the panel on open, trap Tab, Escape closes, focus returns to the toggle.
  useLayoutEffect(() => {
    if (!overlayOpen) return;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      toggleRef.current?.focus({ preventScroll: true });
    };
  }, [overlayOpen]);

  const close = useCallback(() => onToggle?.(false), [onToggle]);
  useEffect(() => {
    if (!overlayOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) trapTab(panelRef.current, e);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [overlayOpen, close]);

  const list =
    items.length === 0 ? (
      <p className="queue-empty">No open questions.</p>
    ) : (
      <ul>
        {items.map(({ question, agent, task }) => (
          <li key={question.id}>
            <button
              type="button"
              className={`queue-item${question.blocking ? ' blocking' : ''}`}
              onClick={() => {
                onOpen(question.agentId, question.id);
                if (collapsed) close();
              }}
              aria-label={`Open question from ${agent?.name ?? question.agentId}`}
            >
              <div className="q-agent">
                {agent?.name ?? question.agentId} <span className={`badge ${question.blocking ? 'badge-blocking' : 'badge-nonblocking'}`}>{question.blocking ? 'BLOCKING' : 'non-blocking'}</span>
              </div>
              <div className="q-task">{task ? `${task.id} · ${task.title}` : question.taskId}</div>
              <div className="q-text">{question.question}</div>
            </button>
          </li>
        ))}
      </ul>
    );

  const summary = (
    <>
      <span>Needs your input</span>
      <span>
        {items.length > 0 && <span className="badge badge-count">{items.length}</span>}
        {blocking > 0 && <span className="note"> {blocking} blocking</span>}
      </span>
    </>
  );

  if (!collapsed) {
    return (
      <aside className="queue" data-mode="docked" aria-label="Needs your input">
        <div className="panel-head">{summary}</div>
        {list}
      </aside>
    );
  }

  return (
    <>
      <div className="queue-bar" data-testid="queue-bar">
        <button
          type="button"
          className={`btn queue-toggle${items.length > 0 ? ' has-items' : ''}`}
          ref={toggleRef}
          aria-expanded={open}
          aria-controls="queue-panel"
          onClick={() => onToggle?.(!open)}
        >
          <span className="queue-toggle-label">{open ? 'Hide' : 'Show'} queue</span>
          <span className="queue-toggle-summary">{summary}</span>
        </button>
      </div>
      {showList && (
        <>
          <div className="queue-backdrop" data-testid="queue-backdrop" onClick={close} aria-hidden="true" />
          <aside
            id="queue-panel"
            className="queue overlay"
            data-mode="collapsed"
            aria-label="Needs your input"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={panelRef}
          >
            <div className="panel-head">
              {summary}
              <button type="button" className="btn queue-close" onClick={close} aria-label="Close queue">
                Close
              </button>
            </div>
            {list}
          </aside>
        </>
      )}
    </>
  );
}
