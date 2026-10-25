import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useApi, useResource } from '../api/hooks';
import type { Opponent, ScheduledGame, Season, Team, Unit } from '../api/contracts';
import { useMe } from '../auth/AuthContext';
import { DEMO_NOW } from '../api/mock/data';
import { parseUnit, selectionQuery, workspaceStore, useWorkspaceSelection, type WorkspaceSelection } from './store';

interface WorkspaceData {
  teams: Team[];
  seasons: Season[];
  games: ScheduledGame[];
  opponents: Opponent[];
}

export interface WorkspaceValue {
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  reload: () => void;
  teams: Team[];
  team: Team | null;
  seasons: Season[];
  season: Season | null;
  games: ScheduledGame[];
  game: ScheduledGame | null;
  opponents: Opponent[];
  opponent: Opponent | null;
  unit: Unit;
  selection: WorkspaceSelection;
  /** Change part of the context; writes the URL query and the mirror store. */
  select: (patch: Partial<WorkspaceSelection>) => void;
  /** A workspace path with the current context query attached. */
  href: (path: string, patch?: Partial<WorkspaceSelection>) => string;
  /** Label helpers shared by every page. */
  opponentName: (opponentId: string | null) => string;
  gameLabel: (game: ScheduledGame | null) => string;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const CONTEXT_KEYS = new Set(['team', 'season', 'game', 'unit']);

/** The next game that is not final, measured against the demo clock in mock mode. */
export function pickCurrentGame(games: ScheduledGame[], nowIso: string): ScheduledGame | null {
  const now = Date.parse(nowIso);
  const upcoming = games
    .filter((g) => g.kind !== 'bye' && g.status !== 'final' && g.status !== 'canceled')
    .sort((a, b) => (a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity) - (b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity));
  return upcoming.find((g) => g.scheduledAt && Date.parse(g.scheduledAt) >= now - 86_400_000) ?? upcoming[0] ?? games[games.length - 1] ?? null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const stored = useWorkspaceSelection();

  const teamParam = params.get('team') ?? stored.team;
  const seasonParam = params.get('season') ?? stored.season;

  const base = useResource(async () => {
    const teams = await api.teams.list();
    const team = teams.find((t) => t.id === teamParam) ?? teams[0] ?? null;
    if (!team) return { teams, seasons: [], games: [], opponents: [] } satisfies WorkspaceData;
    const [seasons, opponents] = await Promise.all([api.seasons.list(team.id), api.seasons.opponents(team.id)]);
    const season = seasons.find((s) => s.id === seasonParam) ?? seasons.find((s) => s.isCurrent) ?? seasons[0] ?? null;
    const games = season ? await api.seasons.games(team.id, season.id) : [];
    return { teams, seasons, games, opponents } satisfies WorkspaceData;
  }, [api, teamParam, seasonParam]);

  const data = base.data;
  const nowIso = api.mode === 'mock' ? DEMO_NOW : new Date().toISOString();

  const resolved = useMemo(() => {
    if (!data) return null;
    const team = data.teams.find((t) => t.id === teamParam) ?? data.teams[0] ?? null;
    const season = data.seasons.find((s) => s.id === seasonParam) ?? data.seasons.find((s) => s.isCurrent) ?? data.seasons[0] ?? null;
    const gameParam = params.get('game') ?? stored.game;
    const game = data.games.find((g) => g.id === gameParam) ?? pickCurrentGame(data.games, nowIso);
    const membershipUnit = me.memberships.find((m) => team && m.teamId === team.id)?.units[0] ?? 'offense';
    const unit: Unit = parseUnit(params.get('unit')) ?? stored.unit ?? membershipUnit;
    return { team, season, game, unit };
  }, [data, teamParam, seasonParam, params, stored.game, stored.unit, me.memberships, nowIso]);

  // Mirror the resolved selection into the store and complete the URL query (replace, so
  // Back never steps through the normalisation).
  useEffect(() => {
    if (!resolved) return;
    const selection: WorkspaceSelection = {
      team: resolved.team?.id ?? null,
      season: resolved.season?.id ?? null,
      game: resolved.game?.id ?? null,
      unit: resolved.unit,
    };
    workspaceStore.set(selection);
    // Page-specific params (for example `t=` on the asset view) are kept as they are.
    const next = new URLSearchParams(selectionQuery(selection));
    for (const [key, value] of params) if (!CONTEXT_KEYS.has(key)) next.append(key, value);
    const wanted = next.toString() ? `?${next.toString()}` : '';
    const have = params.toString() ? `?${params.toString()}` : '';
    if (wanted !== have) setParams(next, { replace: true });
  }, [resolved, params, setParams]);

  const select = useCallback(
    (patch: Partial<WorkspaceSelection>) => {
      const next: WorkspaceSelection = { ...workspaceStore.get(), ...patch };
      if (patch.team !== undefined && patch.team !== workspaceStore.get().team) {
        next.season = null;
        next.game = null;
      }
      if (patch.season !== undefined && patch.season !== workspaceStore.get().season) next.game = null;
      workspaceStore.set(next);
      setParams(new URLSearchParams(selectionQuery(next)));
    },
    [setParams],
  );

  const href = useCallback((path: string, patch?: Partial<WorkspaceSelection>) => `${path}${selectionQuery({ ...workspaceStore.get(), ...patch })}`, []);

  const value = useMemo<WorkspaceValue>(() => {
    const opponents = data?.opponents ?? [];
    const opponentName = (opponentId: string | null) => (opponentId ? (opponents.find((o) => o.id === opponentId)?.shortName ?? 'Unknown opponent') : 'No opponent');
    const gameLabel = (game: ScheduledGame | null) => {
      if (!game) return 'No game selected';
      if (game.kind === 'bye') return `Week ${game.week ?? '?'} · Bye`;
      const at = game.location === 'away' ? 'at' : game.location === 'neutral' ? 'vs (neutral)' : 'vs';
      const who = game.opponentId ? opponentName(game.opponentId) : game.kind === 'playoff' ? 'Playoff (opponent TBD)' : 'TBD';
      return `${game.week ? `Week ${game.week} · ` : ''}${at} ${who}`;
    };
    return {
      status: base.status,
      error: base.error,
      reload: base.reload,
      teams: data?.teams ?? [],
      team: resolved?.team ?? null,
      seasons: data?.seasons ?? [],
      season: resolved?.season ?? null,
      games: data?.games ?? [],
      game: resolved?.game ?? null,
      opponents,
      opponent: resolved?.game?.opponentId ? (opponents.find((o) => o.id === resolved.game!.opponentId) ?? null) : null,
      unit: resolved?.unit ?? 'offense',
      selection: stored,
      select,
      href,
      opponentName,
      gameLabel,
    };
  }, [base.status, base.error, base.reload, data, resolved, stored, select, href]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return value;
}
