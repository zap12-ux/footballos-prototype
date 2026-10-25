import type { Edge, Node } from '@xyflow/react';
import type { StateSnapshot } from '../types';
import type { AgentView } from './derive';
import { buildAgentViews, missingRoles } from './derive';
import type { NodePositions } from './storage';

export interface AgentNodeData extends Record<string, unknown> {
  kind: 'agent';
  view: AgentView;
  selected: boolean;
}

export interface PlaceholderNodeData extends Record<string, unknown> {
  kind: 'placeholder';
  role: string;
}

export type ConsoleNode = Node<AgentNodeData, 'agent'> | Node<PlaceholderNodeData, 'placeholder'>;

export type EdgeKind = 'reports_to' | 'depends_on';

export interface ConsoleEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  taskId?: string;
}

export const NODE_W = 272;
export const NODE_H = 172;
const GAP_X = 36;
const GAP_Y = 120;
/** Specialists wrap into rows of this many nodes so the graph stays readable at 1280 px. */
export const ROW_MAX = 4;

export function placeholderId(role: string): string {
  return `placeholder:${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * Deterministic layered layout: lead(s) centred on the top row, every other node (agents
 * then placeholders, in registry order) on the row below. Manual positions override.
 */
export function layout(views: AgentView[], placeholders: string[], saved: NodePositions): Map<string, { x: number; y: number }> {
  const top = views.filter((v) => v.isLead).map((v) => v.agent.id);
  const bottom = [...views.filter((v) => !v.isLead).map((v) => v.agent.id), ...placeholders.map(placeholderId)];
  const rows: string[][] = [];
  if (top.length) rows.push(top);
  for (let i = 0; i < bottom.length; i += ROW_MAX) rows.push(bottom.slice(i, i + ROW_MAX));
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const totalW = widest * NODE_W + (widest - 1) * GAP_X;
  const pos = new Map<string, { x: number; y: number }>();
  rows.forEach((ids, rowIndex) => {
    const rowW = ids.length * NODE_W + (ids.length - 1) * GAP_X;
    const x0 = (totalW - rowW) / 2;
    ids.forEach((id, i) => pos.set(id, { x: Math.round(x0 + i * (NODE_W + GAP_X)), y: rowIndex * (NODE_H + GAP_Y) }));
  });
  for (const [id, p] of Object.entries(saved)) if (pos.has(id) && Number.isFinite(p.x) && Number.isFinite(p.y)) pos.set(id, p);
  return pos;
}

export interface GraphModel {
  nodes: ConsoleNode[];
  edges: Edge<ConsoleEdgeData>[];
  views: AgentView[];
}

/**
 * Map the server snapshot to React Flow nodes/edges. Renders only what the state contains.
 * `nowIso` only feeds the staleness derivation; pass a coarse clock so node data stays stable.
 */
export function buildGraph(snapshot: StateSnapshot, nowIso: string, saved: NodePositions, selectedId: string | null): GraphModel {
  const views = buildAgentViews(snapshot, nowIso);
  const missing = missingRoles(snapshot);
  const pos = layout(views, missing, saved);
  const nodes: ConsoleNode[] = [
    ...views.map(
      (view): ConsoleNode => ({
        id: view.agent.id,
        type: 'agent',
        position: pos.get(view.agent.id) ?? { x: 0, y: 0 },
        data: { kind: 'agent', view, selected: selectedId === view.agent.id },
        selected: selectedId === view.agent.id,
        focusable: true,
        ariaLabel: `${view.displayName}, ${view.agent.role}, ${view.execLabel}`,
      }),
    ),
    ...missing.map(
      (role): ConsoleNode => ({
        id: placeholderId(role),
        type: 'placeholder',
        position: pos.get(placeholderId(role)) ?? { x: 0, y: 0 },
        data: { kind: 'placeholder', role },
        draggable: true,
        selectable: false,
        focusable: true,
        ariaLabel: `${role}, Not started`,
      }),
    ),
  ];

  const edges: Edge<ConsoleEdgeData>[] = [];
  const leads = views.filter((v) => v.isLead);
  const lead = leads[0];
  if (lead) {
    for (const v of views) {
      if (v.isLead) continue;
      edges.push({
        id: `reports:${v.agent.id}->${lead.agent.id}`,
        source: v.agent.id,
        target: lead.agent.id,
        label: 'reports to',
        type: 'smoothstep',
        className: 'edge-reports',
        data: { kind: 'reports_to' },
        ariaLabel: `${v.displayName} reports to ${lead.displayName}`,
      });
    }
  }
  const taskOwner = new Map(snapshot.tasks.filter((t) => t.agentId).map((t) => [t.id, t.agentId as string]));
  const agentIds = new Set(views.map((v) => v.agent.id));
  const seen = new Set<string>();
  for (const t of snapshot.tasks) {
    if (!t.agentId || !agentIds.has(t.agentId)) continue;
    for (const dep of t.dependsOn ?? []) {
      const owner = taskOwner.get(dep);
      if (!owner || owner === t.agentId || !agentIds.has(owner)) continue;
      const id = `dep:${t.agentId}->${owner}:${dep}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        source: t.agentId,
        target: owner,
        label: `depends on ${dep}`,
        type: 'smoothstep',
        className: 'edge-depends',
        animated: false,
        data: { kind: 'depends_on', taskId: dep },
        ariaLabel: `${t.agentId} depends on task ${dep}`,
      });
    }
  }
  return { nodes, edges, views };
}
