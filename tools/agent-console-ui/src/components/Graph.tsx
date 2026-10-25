import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, applyNodeChanges, type Edge, type NodeChange, type NodeMouseHandler, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StateSnapshot } from '../types';
import { buildGraph, type ConsoleEdgeData, type ConsoleNode } from '../lib/graph';
import { loadPositions, savePositions, type NodePositions } from '../lib/storage';
import { coarse } from '../lib/time';
import { AgentNodeView, PlaceholderNodeView } from './AgentNode';

interface Props {
  snapshot: StateSnapshot;
  nowIso: string;
  selectedId: string | null;
  onSelect: (agentId: string | null) => void;
}

const nodeTypes = { agent: AgentNodeView, placeholder: PlaceholderNodeView };

export function Graph({ snapshot, nowIso, selectedId, onSelect }: Props) {
  const runId = snapshot.run?.id ?? 'no-run';
  const [saved, setSaved] = useState<NodePositions>(() => loadPositions(runId));
  useEffect(() => setSaved(loadPositions(runId)), [runId]);

  const coarseNow = coarse(nowIso);
  const model = useMemo(() => buildGraph(snapshot, coarseNow, saved, selectedId), [snapshot, coarseNow, saved, selectedId]);
  const [nodes, setNodes] = useState<ConsoleNode[]>(model.nodes);
  useEffect(() => setNodes(model.nodes), [model.nodes]);

  const onNodesChange = useCallback((changes: NodeChange<ConsoleNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);
  const onNodeDragStop = useCallback(
    (_: unknown, node: ConsoleNode) => {
      const next = { ...saved, [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) } };
      setSaved(next);
      savePositions(runId, next);
    },
    [saved, runId],
  );
  const onNodeClick: NodeMouseHandler<ConsoleNode> = useCallback(
    (_, node) => {
      if (node.type === 'agent') onSelect(node.id);
    },
    [onSelect],
  );
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = (e.target as HTMLElement).closest('.react-flow__node') as HTMLElement | null;
      const id = el?.getAttribute('data-id');
      if (id && !id.startsWith('placeholder:')) {
        e.preventDefault();
        onSelect(id);
      }
    },
    [onSelect],
  );

  // Re-fit when the pane changes size (drawer opens/closes, window resizes).
  const wrapRef = useRef<HTMLElement>(null);
  const instanceRef = useRef<ReactFlowInstance<ConsoleNode, Edge<ConsoleEdgeData>> | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void instanceRef.current?.fitView({ padding: 0.25, maxZoom: 1, duration: 200 }), 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const edges = model.edges as Edge<ConsoleEdgeData>[];
  return (
    <main className="graph" aria-label="Agent graph" onKeyDown={onKeyDown} ref={wrapRef}>
      <ReactFlow<ConsoleNode, Edge<ConsoleEdgeData>>
        onInit={(inst) => {
          instanceRef.current = inst;
        }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.6}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: false }}
        colorMode="dark"
        defaultEdgeOptions={{ labelShowBg: true, labelBgPadding: [4, 2], labelBgBorderRadius: 3 }}
      >
        <Background gap={24} color="rgba(255,255,255,0.06)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {nodes.length === 0 && <div className="graph-empty">No agents registered for this run and no planned roles to show.</div>}
    </main>
  );
}
