import { useEffect, useId, useState } from 'react';
import type { Agent, Question, QuestionResponse, Task } from '../types';
import { responseStateLabel } from '../lib/derive';
import { clearDraft, loadDraft, saveDraft } from '../lib/storage';
import { relativeTime } from '../lib/time';
import type { SubmitInput, SubmitOutcome } from '../hooks/useConsole';

interface Props {
  question: Question;
  agent: Agent | null;
  task: Task | null;
  responses: QuestionResponse[];
  nowIso: string;
  highlighted?: boolean;
  onSubmit: (questionId: string, questionVersion: number, input: SubmitInput) => Promise<SubmitOutcome>;
}

export function QuestionCard({ question, agent, task, responses, nowIso, highlighted, onSubmit }: Props) {
  const draft = loadDraft(question.id);
  const [option, setOption] = useState<string | null>(draft?.option ?? null);
  const [text, setText] = useState(draft?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const uid = useId();

  useEffect(() => {
    saveDraft(question.id, { option, text });
  }, [question.id, option, text]);

  const open = question.status === 'open';
  const options = question.options ?? [];
  const canSubmit = open && !busy && (Boolean(option) || text.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const out = await onSubmit(question.id, question.questionVersion, { option, text });
    setBusy(false);
    if (out.ok) {
      clearDraft(question.id);
      setOption(null);
      setText('');
      setSent(true);
    } else {
      setError(out.message);
    }
  }

  return (
    <article className={`qcard${question.blocking ? ' blocking' : ''}${highlighted ? ' highlight' : ''}`} id={`question-${question.id}`} data-testid={`question-${question.id}`} aria-labelledby={`${uid}-q`}>
      <div className="qcard-meta">
        <span className={`badge ${question.blocking ? 'badge-blocking' : 'badge-nonblocking'}`}>{question.blocking ? 'BLOCKING' : 'non-blocking'}</span>
        <span>from {agent?.name ?? question.agentId}</span>
        <span>task {task ? `${task.id} · ${task.title}` : question.taskId}</span>
        <span>v{question.questionVersion}</span>
        <span>{question.status}</span>
        <span>{relativeTime(question.createdAt, nowIso)}</span>
      </div>
      <p className="qcard-text" id={`${uid}-q`}>
        {question.question}
      </p>
      {question.why && (
        <p className="qcard-why">
          <strong>Why: </strong>
          {question.why}
        </p>
      )}
      {open && (
        <form onSubmit={submit}>
          {options.length > 0 && (
            <fieldset>
              <legend>Options{question.recommendation ? ' (recommendation marked)' : ''}</legend>
              {options.map((opt, i) => {
                const id = `${uid}-opt-${i}`;
                return (
                  <label key={opt} className="option" htmlFor={id}>
                    <input id={id} type="radio" name={`${uid}-option`} value={opt} checked={option === opt} onChange={() => setOption(opt)} disabled={busy} />
                    <span>
                      {opt}
                      {question.recommendation === opt && <span className="rec">RECOMMENDED</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <label className="field-label" htmlFor={`${uid}-text`}>
            Your answer / notes{options.length > 0 ? ' (optional with an option selected)' : ''}
          </label>
          <textarea id={`${uid}-text`} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder="Type your answer…" />
          <div className="qcard-actions">
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {busy ? 'Submitting…' : 'Submit answer'}
            </button>
            {option && (
              <button type="button" className="btn-link" onClick={() => setOption(null)} disabled={busy}>
                clear option
              </button>
            )}
            {error && (
              <span className="qcard-error" role="alert">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
      {!open && sent && <p className="note">Answer submitted.</p>}
      {responses.length > 0 && (
        <div className="answers">
          <div className="note">Previous answers</div>
          {responses.map((r) => (
            <div className="answer" key={r.id} data-testid={`response-${r.id}`}>
              <div className="a-body">
                {r.option && <strong>{r.option}</strong>}
                {r.option && r.text ? ' — ' : ''}
                {r.text}
                {!r.option && !r.text && <em className="note">(empty)</em>}
              </div>
              <div className={`a-state ${r.state}`}>
                {responseStateLabel(r)}
                {r.via === 'lead_continuation' && r.state !== 'submitted' ? ' (via lead)' : ''}
                <div>{relativeTime(r.updatedAt ?? r.createdAt, nowIso)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
