import type { Agent, ExecState } from './types.js';

const STALE_SENSITIVE: Agent['selfState'][] = ['working', 'reviewing', 'waiting_on_dependency'];

/**
 * §3. Precedence: runtime terminal state > open blocking question > staleness > self-report.
 * `completed`/`failed` come only from runtime events; `waiting_for_you` and `disconnected`
 * are derived, never self-reported.
 */
export function deriveExecState(
  agent: Agent,
  openBlockingQuestionCount: number,
  nowMs: number,
  staleAfterMin: number,
): ExecState {
  if (agent.runtimeState === 'completed' || agent.runtimeState === 'failed') return agent.runtimeState;
  if (openBlockingQuestionCount > 0) return 'waiting_for_you';
  if (STALE_SENSITIVE.includes(agent.selfState)) {
    const last = latestMs(agent.lastAgentUpdateAt, agent.lastRuntimeUpdateAt);
    if (last !== null && nowMs - last > staleAfterMin * 60_000) return 'disconnected';
  }
  return agent.selfState;
}

function latestMs(...values: (string | null)[]): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
}
