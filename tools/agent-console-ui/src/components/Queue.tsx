import type { QueueItem } from '../lib/derive';

interface Props {
  items: QueueItem[];
  onOpen: (agentId: string, questionId: string) => void;
}

export function Queue({ items, onOpen }: Props) {
  const blocking = items.filter((i) => i.question.blocking).length;
  return (
    <aside className="queue" aria-label="Needs your input">
      <div className="panel-head">
        <span>Needs your input</span>
        <span>
          {items.length > 0 && <span className="badge badge-count">{items.length}</span>}
          {blocking > 0 && <span className="note"> {blocking} blocking</span>}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="queue-empty">No open questions.</p>
      ) : (
        <ul>
          {items.map(({ question, agent, task }) => (
            <li key={question.id}>
              <button
                type="button"
                className={`queue-item${question.blocking ? ' blocking' : ''}`}
                onClick={() => onOpen(question.agentId, question.id)}
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
      )}
    </aside>
  );
}
