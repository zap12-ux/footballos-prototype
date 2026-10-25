import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from './lib/api';
import { buildAgentViews, buildQueue } from './lib/derive';
import { useConsole } from './hooks/useConsole';
import { TopBar } from './components/TopBar';
import { Queue } from './components/Queue';
import { Graph } from './components/Graph';
import { Drawer } from './components/Drawer';
import { NowContext } from './hooks/NowContext';
import { useLayoutMode } from './hooks/useLayoutMode';

export function App({ api }: { api?: ApiClient }) {
  const c = useConsole(api);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusQuestionId, setFocusQuestionId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const layout = useLayoutMode();
  const snapshot = c.state.snapshot;

  const views = useMemo(() => (snapshot ? buildAgentViews(snapshot, c.nowIso) : []), [snapshot, c.nowIso]);
  const queue = useMemo(() => (snapshot ? buildQueue(snapshot) : []), [snapshot]);
  const selected = views.find((v) => v.agent.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && snapshot && !snapshot.agents.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [selectedId, snapshot]);

  const openQuestion = useCallback((agentId: string, questionId: string) => {
    setSelectedId(agentId);
    setFocusQuestionId(questionId);
  }, []);
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setFocusQuestionId(null);
  }, []);

  const banner = c.authError
    ? 'No owner token. Open the console from the URL the server printed (http://127.0.0.1:4800/#token=…). The token is kept in this tab only.'
    : c.loadError;

  return (
    <NowContext.Provider value={c.nowIso}>
    <div
      className={`app${selected ? ' has-drawer' : ''}${banner ? ' has-banner' : ''}`}
      data-drawer-mode={layout.drawerMode}
      data-queue-mode={layout.queueMode}
      data-testid="app"
    >
      <TopBar
        runs={c.runs}
        selectedRunId={c.selectedRunId}
        onSelectRun={c.selectRun}
        snapshot={snapshot}
        connection={c.connection}
        lastSeq={c.lastSeq}
        nowIso={c.nowIso}
        onRefresh={() => void c.refresh()}
      />
      {banner && (
        <div className="banner" role="alert">
          {banner}
        </div>
      )}
      <Queue items={queue} onOpen={openQuestion} mode={layout.queueMode} open={queueOpen} onToggle={setQueueOpen} />
      {snapshot ? (
        <Graph snapshot={snapshot} nowIso={c.nowIso} selectedId={selectedId} onSelect={select} />
      ) : (
        <main className="graph" aria-label="Agent graph">
          <div className="graph-empty">{c.loading ? 'Loading state…' : 'No state loaded.'}</div>
        </main>
      )}
      {selected && snapshot && (
        <Drawer
          view={selected}
          snapshot={snapshot}
          events={c.state.events}
          nowIso={c.nowIso}
          api={c.api}
          focusQuestionId={focusQuestionId}
          mode={layout.drawerMode}
          onClose={() => select(null)}
          onSubmit={c.submitResponse}
        />
      )}
    </div>
    </NowContext.Provider>
  );
}
