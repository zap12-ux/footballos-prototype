import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ConsoleNode } from '../lib/graph';
import { TASK_STATUS_LABEL } from '../lib/derive';
import { relativeTime } from '../lib/time';
import { useNow } from '../hooks/NowContext';

type AgentProps = NodeProps<Extract<ConsoleNode, { type: 'agent' }>>;
type PlaceholderProps = NodeProps<Extract<ConsoleNode, { type: 'placeholder' }>>;

export function AgentNodeView({ data }: AgentProps) {
  const { view, selected } = data;
  const nowIso = useNow();
  const task = view.currentTask;
  const pending = view.openQuestions.length;
  const blocker = view.blockers[0];
  return (
    <div className={`node state-${view.execState}${selected ? ' selected' : ''}`} data-testid={`node-${view.agent.id}`}>
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="node-head">
        <div>
          <div className="node-name">
            {view.agent.name}
            {view.instanceLabel && <small> {view.instanceLabel}</small>}
          </div>
          <div className="node-role">{view.agent.role}</div>
        </div>
        <span className={`chip state-${view.execState}`}>{view.execLabel}</span>
      </div>
      <div className="node-task">
        {task ? (
          <>
            {task.title} <span className="task-chip">task {TASK_STATUS_LABEL[task.status] ?? task.status}</span>
          </>
        ) : (
          <span className="note">No task assigned</span>
        )}
      </div>
      <div className="node-foot">
        <div className="node-update">
          <span className="mono">{view.lastUpdateAt ? relativeTime(view.lastUpdateAt, nowIso) : 'no updates'}</span>
          {view.lastMessage ? ` · ${view.lastMessage}` : ''}
        </div>
        {blocker && (
          <div className="node-blocker">
            blocked by <span className="mono">{blocker.taskId}</span>
            {blocker.title ? ` · ${blocker.title}` : ''}
            {view.blockers.length > 1 ? ` (+${view.blockers.length - 1})` : ''}
          </div>
        )}
        {pending > 0 && (
          <div>
            <span className="badge badge-count">{pending}</span> pending question{pending === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  );
}

export function PlaceholderNodeView({ data }: PlaceholderProps) {
  return (
    <div className="node placeholder" data-testid={`placeholder-${data.role}`}>
      <div className="node-head">
        <div>
          <div className="node-name">{data.role}</div>
          <div className="node-role">planned role · no agent registered</div>
        </div>
        <span className="chip state-not_started">Not started</span>
      </div>
    </div>
  );
}
