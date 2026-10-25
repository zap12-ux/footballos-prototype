import { describe, expect, it } from 'vitest';
import { buildGraph, layout, placeholderId, ROW_MAX } from '../lib/graph';
import { buildAgentViews, buildQueue, missingRoles, plannedRoles, staleAfterMin } from '../lib/derive';
import { agent, BE1, BE2, FE, LEAD, NOW, Q1, Q2, snapshot, task } from './fixtures';
import { DEFAULT_PLANNED_ROLES } from '../types';

describe('state → nodes mapping', () => {
  it('creates one node per agent instance and labels shared roles with instance numbers', () => {
    const { nodes, views } = buildGraph(snapshot(), NOW, {}, null);
    const agentNodes = nodes.filter((n) => n.type === 'agent');
    expect(agentNodes.map((n) => n.id)).toEqual([LEAD, FE, BE1, BE2]);
    const be = views.filter((v) => v.agent.role === 'Backend / Team Platform');
    expect(be.map((v) => v.instanceLabel)).toEqual(['instance #1', 'instance #2']);
    expect(views.find((v) => v.agent.id === FE)?.instanceLabel).toBeNull();
    expect(be[1].displayName).toBe('platform-2 (instance #2)');
  });

  it('adds "Not started" placeholders for planned roles without an agent', () => {
    const { nodes } = buildGraph(snapshot(), NOW, {}, null);
    const placeholders = nodes.filter((n) => n.type === 'placeholder').map((n) => (n.data as { role: string }).role);
    expect(placeholders).toEqual(['Media / Document Processing', 'Applied AI / Scouting', 'QA / Security', 'Deployment / Reliability']);
    expect(nodes.find((n) => n.id === placeholderId('QA / Security'))?.ariaLabel).toContain('Not started');
  });

  it('reads plannedRoles and staleAfterMin from state when provided', () => {
    const s = snapshot({ plannedRoles: ['Lead / Integrator', 'Custom Role'], staleAfterMin: 5 });
    expect(plannedRoles(s)).toEqual(['Lead / Integrator', 'Custom Role']);
    expect(missingRoles(s)).toEqual(['Custom Role']);
    expect(staleAfterMin(s)).toBe(5);
    expect(plannedRoles(snapshot())).toEqual([...DEFAULT_PLANNED_ROLES]);
    expect(staleAfterMin(snapshot())).toBe(20);
  });

  it('derives execution state: waiting_for_you from open blocking questions, disconnected from staleness', () => {
    const views = buildAgentViews(snapshot(), NOW);
    const byId = Object.fromEntries(views.map((v) => [v.agent.id, v]));
    expect(byId[FE].execState).toBe('waiting_for_you');
    expect(byId[FE].execLabel).toBe('Waiting for you');
    expect(byId[BE1].execState).toBe('working'); // non-blocking question only
    expect(byId[BE2].execState).toBe('disconnected'); // 40 min stale while waiting_on_dependency
    expect(byId[LEAD].execState).toBe('working');
  });

  it('never overrides runtime-set completed/failed and keeps task status separate', () => {
    const s = snapshot();
    s.agents[1] = { ...s.agents[1], execState: 'completed', lastUpdateAt: '2026-10-25T09:00:00.000Z' };
    const v = buildAgentViews(s, NOW).find((x) => x.agent.id === FE)!;
    expect(v.execState).toBe('completed');
    expect(v.currentTask?.status).toBe('in_progress');
  });

  it('lists blockers from blockedByTaskId and unmet dependsOn with task titles', () => {
    const views = buildAgentViews(snapshot(), NOW);
    const be2 = views.find((v) => v.agent.id === BE2)!;
    expect(be2.blockers).toEqual([{ taskId: 'B1', title: 'Build runtime', reason: 'blockedByTaskId', ownerAgentId: BE1 }]);
    const fe = views.find((v) => v.agent.id === FE)!;
    expect(fe.blockers.map((b) => b.reason)).toEqual(['dependsOn']);
    // met dependency (verified) is not a blocker
    const s = snapshot();
    s.tasks = s.tasks.map((t) => (t.id === 'B1' ? { ...t, status: 'verified' } : t));
    expect(buildAgentViews(s, NOW).find((v) => v.agent.id === FE)!.blockers).toEqual([]);
  });

  it('derives "reports to" edges to the lead and "depends on" edges from cross-agent task dependencies only', () => {
    const { edges } = buildGraph(snapshot(), NOW, {}, null);
    const reports = edges.filter((e) => e.data?.kind === 'reports_to');
    expect(reports.map((e) => [e.source, e.target, e.label])).toEqual([
      [FE, LEAD, 'reports to'],
      [BE1, LEAD, 'reports to'],
      [BE2, LEAD, 'reports to'],
    ]);
    const deps = edges.filter((e) => e.data?.kind === 'depends_on');
    expect(deps.map((e) => [e.source, e.target, e.label])).toEqual([
      [LEAD, FE, 'depends on F1'],
      [FE, BE1, 'depends on B1'],
      [BE2, BE1, 'depends on B1'],
    ]);
  });

  it('does not invent edges when tasks depend on unassigned or same-agent tasks', () => {
    const s = snapshot({ tasks: [task({ id: 'X', title: 'x', agentId: FE, dependsOn: ['Y', 'Z'] }), task({ id: 'Y', title: 'y', agentId: FE }), task({ id: 'Z', title: 'z' })] });
    const { edges } = buildGraph(s, NOW, {}, null);
    expect(edges.filter((e) => e.data?.kind === 'depends_on')).toEqual([]);
  });

  it('lays out the lead on top, wraps specialists in rows, deterministically, honouring saved positions', () => {
    const views = buildAgentViews(snapshot(), NOW);
    const a = layout(views, ['R1', 'R2', 'R3'], {});
    const b = layout(views, ['R1', 'R2', 'R3'], {});
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.get(LEAD)?.y).toBe(0);
    const rowYs = new Set([FE, BE1, BE2, placeholderId('R1')].map((id) => a.get(id)?.y));
    expect(rowYs.size).toBe(1);
    expect(a.get(placeholderId('R2'))!.y).toBeGreaterThan(a.get(placeholderId('R1'))!.y); // wrapped after ROW_MAX
    expect(ROW_MAX).toBe(4);
    const c = layout(views, [], { [FE]: { x: 999, y: 888 } });
    expect(c.get(FE)).toEqual({ x: 999, y: 888 });
  });

  it('builds the needs-your-input queue with blocking first then oldest first', () => {
    const q = buildQueue(snapshot());
    expect(q.map((i) => i.question.id)).toEqual([Q1, Q2]);
    expect(q[0].agent?.name).toBe('console-ui');
    expect(q[0].task?.title).toBe('Build UI');
  });

  it('marks node data with the open question count and current task', () => {
    const { nodes } = buildGraph(snapshot(), NOW, {}, FE);
    const fe = nodes.find((n) => n.id === FE)!;
    expect(fe.selected).toBe(true);
    const data = fe.data as { view: { openQuestions: unknown[]; currentTask: { title: string } } };
    expect(data.view.openQuestions).toHaveLength(1);
    expect(data.view.currentTask.title).toBe('Build UI');
    expect(agent({ id: 'z', name: 'z', role: 'r' }).runId).toBeDefined();
  });
});
