import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConsoleEvent, GitInfo, StateSnapshot, Task, Verification } from '../types';
import type { ApiClient } from '../lib/api';
import { TASK_STATUS_LABEL, responsesFor, type AgentView } from '../lib/derive';
import { trapTab } from '../lib/focus';
import { formatClock, relativeTime } from '../lib/time';
import type { SubmitInput, SubmitOutcome } from '../hooks/useConsole';
import type { DrawerMode } from '../hooks/useLayoutMode';
import { QuestionCard } from './QuestionCard';

interface Props {
  view: AgentView;
  snapshot: StateSnapshot;
  events: ConsoleEvent[];
  nowIso: string;
  api: ApiClient;
  focusQuestionId: string | null;
  /** 'docked' = third grid column (wide windows); 'overlay' = fixed panel over the graph (D-2). */
  mode?: DrawerMode;
  onClose: () => void;
  onSubmit: (questionId: string, questionVersion: number, input: SubmitInput) => Promise<SubmitOutcome>;
}

/** Fallback for the sticky header height until it is measured (matches .drawer .qcard scroll-margin-top in CSS). */
const DEFAULT_HEAD_HEIGHT = 72;

const HISTORY_TYPES = new Set([
  'agent.status',
  'agent.log',
  'agent.spawned',
  'agent.completed',
  'agent.failed',
  'agent.resumed',
  'agent.registered',
  'message.delivered',
  'task.result',
  'task.updated',
  'question.asked',
  'response.submitted',
  'response.delivered',
  'response.acknowledged',
  'verification.recorded',
]);

function describe(ev: ConsoleEvent): string {
  const p = ev.payload ?? {};
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  switch (ev.type) {
    case 'agent.status':
      return `${str('state') || str('execState')}${str('message') ? ` — ${str('message')}` : ''}`;
    case 'agent.log':
      return str('message');
    case 'task.result': {
      const r = (p.result && typeof p.result === 'object' ? p.result : p) as { status?: string; summary?: string };
      return `${r.status ?? ''}${r.summary ? ` — ${r.summary}` : ''}`;
    }
    case 'task.updated': {
      const t = (p.task && typeof p.task === 'object' ? p.task : p) as { status?: string };
      return t.status ? `task status → ${t.status}` : '';
    }
    case 'question.asked': {
      const q = (p.question && typeof p.question === 'object' ? p.question : p) as { question?: string; blocking?: boolean };
      return `${q.blocking ? '[blocking] ' : ''}${q.question ?? ''}`;
    }
    case 'response.submitted': {
      const r = (p.response && typeof p.response === 'object' ? p.response : p) as { option?: string | null; text?: string | null };
      return `answer submitted: ${[r.option, r.text].filter(Boolean).join(' — ')}`;
    }
    case 'response.delivered':
      return `answer delivered to agent${str('via') ? ` (${str('via')})` : ''}`;
    case 'message.delivered':
      return 'answer delivered via lead continuation';
    case 'response.acknowledged':
      return 'agent acknowledged the answer';
    default:
      return str('message') || str('note') || str('summary') || '';
  }
}

export function Drawer({ view, snapshot, events, nowIso, api, focusQuestionId, mode = 'docked', onClose, onSubmit }: Props) {
  const agent = view.agent;
  const [git, setGit] = useState<GitInfo | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlay = mode === 'overlay';

  useEffect(() => {
    let cancelled = false;
    setGit(null);
    setGitError(null);
    api
      .getGit(agent.id)
      .then((g) => !cancelled && setGit(g))
      .catch((e: unknown) => !cancelled && setGitError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [api, agent.id]);

  // D-3: the drawer header is sticky inside the scroll container, so a plain scrollIntoView puts the
  // card's top under it. Measure the header and give the card a matching scroll-margin-top first.
  useEffect(() => {
    if (!focusQuestionId) return;
    const el = document.getElementById(`question-${focusQuestionId}`);
    if (!el) return;
    const measured = headRef.current?.getBoundingClientRect().height ?? 0;
    const headHeight = measured > 0 ? Math.ceil(measured) : DEFAULT_HEAD_HEIGHT;
    el.style.scrollMarginTop = `${headHeight}px`;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const input = el.querySelector<HTMLElement>('input, textarea');
    input?.focus({ preventScroll: true });
    // `mode` is a dependency on purpose: switching docked <-> overlay remounts the panel (the overlay
    // adds a backdrop sibling), so the card is scrolled back under the header again.
  }, [focusQuestionId, agent.id, mode]);

  // D-2 overlay mode: move focus into the panel on open (the focused question input if any, else the
  // panel itself), and return focus to the element that opened it (queue item or graph node) on close.
  useLayoutEffect(() => {
    if (!overlay) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    const input = focusQuestionId ? document.getElementById(`question-${focusQuestionId}`)?.querySelector<HTMLElement>('input, textarea') : null;
    if (input) input.focus({ preventScroll: true });
    else root?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected && !root?.contains(opener) && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
    // Re-run only when the overlay opens/closes (not on every agent change: the opener would then be inside the drawer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Escape closes the overlay wherever focus is (focus can land on <body> after a resize remount),
  // and Tab is trapped inside the panel.
  useEffect(() => {
    if (!overlay) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && rootRef.current) trapTab(rootRef.current, e);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [overlay, onClose]);

  const tasks = view.tasks;
  const questions = snapshot.questions.filter((q) => q.agentId === agent.id).sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.createdAt.localeCompare(a.createdAt));
  const verifications = snapshot.verifications.filter((v) => tasks.some((t) => t.id === v.taskId));
  const history = events.filter((e) => e.agentId === agent.id && HISTORY_TYPES.has(e.type)).slice(-200);
  const taskById = new Map(snapshot.tasks.map((t) => [t.id, t]));

  const panel = (
    <aside
      className={`drawer${overlay ? ' overlay' : ''}`}
      data-mode={mode}
      aria-label={`Details for ${view.displayName}`}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      tabIndex={-1}
      ref={rootRef}
    >
      <div className="drawer-head" ref={headRef}>
        <div>
          <h2>{view.displayName}</h2>
          <div className="sub">
            {agent.role} · <span className={`chip state-${view.execState}`}>{view.execLabel}</span>
          </div>
        </div>
        <button type="button" className="btn drawer-close" onClick={onClose} aria-label="Close details">
          Close
        </button>
      </div>
      <div className="drawer-body" ref={bodyRef}>
        <section className="section">
          <h3>Questions {view.openQuestions.length > 0 && <span className="badge badge-count">{view.openQuestions.length} open</span>}</h3>
          {questions.length === 0 && <p className="note">This agent has not asked anything.</p>}
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              agent={agent}
              task={taskById.get(q.taskId) ?? null}
              responses={responsesFor(snapshot, q.id)}
              nowIso={nowIso}
              highlighted={focusQuestionId === q.id}
              onSubmit={onSubmit}
            />
          ))}
        </section>

        <section className="section">
          <h3>Tasks</h3>
          {tasks.length === 0 && <p className="note">No task assigned.</p>}
          {tasks.map((t) => (
            <TaskBlock key={t.id} task={t} />
          ))}
        </section>

        <section className="section">
          <h3>Blockers and dependencies</h3>
          {view.blockers.length === 0 ? (
            <p className="note">None recorded.</p>
          ) : (
            <ul className="list">
              {view.blockers.map((b) => (
                <li key={`${b.reason}:${b.taskId}`}>
                  <span className="mono">{b.taskId}</span>
                  {b.title ? ` · ${b.title}` : ''} <span className="note">({b.reason === 'blockedByTaskId' ? 'blockedByTaskId' : 'unmet dependsOn'})</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section">
          <h3>Branch and worktree</h3>
          <dl className="kv">
            <dt>branch</dt>
            <dd className="mono">{agent.branch ?? '—'}</dd>
            <dt>worktree</dt>
            <dd className="mono">{agent.worktree ?? '—'}</dd>
            <dt>runtime id</dt>
            <dd className="mono">{agent.runtimeAgentId ?? '—'}</dd>
          </dl>
        </section>

        <section className="section">
          <h3>
            Changed files and commits <span className="badge badge-git">from git</span>
          </h3>
          {gitError && <p className="note">Could not read git info: {gitError}</p>}
          {!git && !gitError && <p className="note">Loading…</p>}
          {git && (
            <>
              <dl className="kv">
                <dt>git branch</dt>
                <dd className="mono">{git.branch ?? '—'}</dd>
                <dt>ahead</dt>
                <dd className="mono">{git.ahead}</dd>
                <dt>merged</dt>
                <dd>{git.mergedIntoIntegration ? 'merged into integration' : 'not merged into integration'}</dd>
              </dl>
              <div className="note">Commits ({git.commits.length})</div>
              <ul className="file-list list plain">
                {git.commits.length === 0 && <li className="note">none</li>}
                {git.commits.map((c) => (
                  <li key={c.sha}>
                    {c.sha.slice(0, 8)} {c.subject ?? c.message ?? ''}
                  </li>
                ))}
              </ul>
              <div className="note">Changed files ({git.changedFiles.length})</div>
              <ul className="file-list list plain">
                {git.changedFiles.length === 0 && <li className="note">none</li>}
                {git.changedFiles.map((f) => {
                  // The server sends { status, path } (git name-status); tolerate plain strings.
                  const path = typeof f === 'string' ? f : f.path;
                  const status = typeof f === 'string' ? '' : (f.status ?? '');
                  return (
                    <li key={path}>
                      {status ? <span className="note">{status} </span> : null}
                      {path}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <section className="section">
          <h3>Tests executed</h3>
          <TestsBlock tasks={tasks} verifications={verifications} nowIso={nowIso} />
        </section>

        <section className="section">
          <h3>Activity</h3>
          {history.length === 0 ? (
            <p className="note">No activity recorded yet.</p>
          ) : (
            <ul className="history" aria-label="Activity history">
              {history.map((e) => (
                <li key={e.id}>
                  <span className="h-time" title={e.ts}>
                    {formatClock(e.ts)}
                  </span>
                  <span>
                    <span className="h-type">
                      {e.type}
                      {e.source ? ` · ${e.source}` : ''}
                    </span>{' '}
                    <span className="h-msg">{describe(e)}</span> <span className="note">{relativeTime(e.ts, nowIso)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section">
          <h3>Runtime control</h3>
          <p className="note-control">Pause/stop/restart are only available to the lead's Claude Code session.</p>
        </section>
      </div>
    </aside>
  );

  if (!overlay) return panel;
  return (
    <>
      <div className="drawer-backdrop" data-testid="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      {panel}
    </>
  );
}

function TaskBlock({ task }: { task: Task }) {
  const r = task.result;
  const done = task.status === 'integrated' || task.status === 'verified' || task.status === 'ready_for_review';
  return (
    <div className="qcard" data-testid={`task-${task.id}`}>
      <div className="qcard-meta">
        <span className="mono">{task.id}</span>
        <span className="task-chip">task {TASK_STATUS_LABEL[task.status] ?? task.status}</span>
        {task.branch && <span className="mono">{task.branch}</span>}
      </div>
      <p className="qcard-text">{task.title}</p>
      <p className="qcard-why">{task.objective}</p>
      <div className="note">Acceptance criteria</div>
      <ul className="list">
        {(task.acceptanceCriteria ?? []).map((c, i) => (
          <li key={i}>{c}</li>
        ))}
        {(task.acceptanceCriteria ?? []).length === 0 && <li className="note">none listed</li>}
      </ul>
      {task.dependsOn?.length > 0 && (
        <p className="note">
          depends on: <span className="mono">{task.dependsOn.join(', ')}</span>
        </p>
      )}
      <div className="note">{done ? 'Completed work (agent self-report)' : 'Remaining work'}</div>
      {r ? (
        <>
          <p>
            <strong>{r.status}</strong> — {r.summary}
          </p>
          {r.commit && (
            <p className="note">
              commit <span className="mono">{r.commit}</span>
              {r.branch ? ` on ${r.branch}` : ''}
            </p>
          )}
          {r.changedFiles.length > 0 && (
            <ul className="file-list list plain">
              {r.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {r.limitations.length > 0 && (
            <>
              <div className="note">Limitations</div>
              <ul className="list">
                {r.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </>
          )}
          {r.followUps.length > 0 && (
            <>
              <div className="note">Follow-ups</div>
              <ul className="list">
                {r.followUps.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="note">{done ? 'No result report recorded.' : `Task is ${TASK_STATUS_LABEL[task.status] ?? task.status}; no result reported yet.`}</p>
      )}
    </div>
  );
}

function TestsBlock({ tasks, verifications, nowIso }: { tasks: Task[]; verifications: Verification[]; nowIso: string }) {
  const self = tasks.flatMap((t) => (t.result?.testsRun ?? []).map((tr) => ({ taskId: t.id, ...tr })));
  if (self.length === 0 && verifications.length === 0) return <p className="note">No tests recorded for this agent's tasks.</p>;
  return (
    <>
      {verifications.length > 0 && (
        <>
          <div className="note">
            <span className="badge badge-verified">verified by lead/QA</span>
          </div>
          <ul className="list plain">
            {verifications.map((v) => (
              <li key={v.id} data-testid={`verification-${v.id}`}>
                <span className={v.passed ? 'pass' : 'fail'}>{v.passed ? 'PASS' : 'FAIL'}</span> <span className="mono">{v.kind}</span>
                {v.command ? (
                  <>
                    {' '}
                    <span className="mono">{v.command}</span>
                  </>
                ) : null}{' '}
                — {v.resultSummary} <span className="note">task {v.taskId} · {relativeTime(v.createdAt, nowIso)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {self.length > 0 && (
        <>
          <div className="note">
            <span className="badge badge-self">agent self-report</span>
          </div>
          <ul className="list plain">
            {self.map((t, i) => (
              <li key={i}>
                <span className={t.passed ? 'pass' : 'fail'}>{t.passed ? 'PASS' : 'FAIL'}</span> <span className="mono">{t.command}</span> — {t.summary} <span className="note">task {t.taskId}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
