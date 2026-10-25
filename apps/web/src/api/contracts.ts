/**
 * Contract vocabulary for the web app.
 *
 * Every record, enum and request/response type comes from `@footballos/contracts` (the
 * authoritative zod package owned by Backend; CONTRACTS.md §1–§14). This module re-exports
 * those types and adds the few coach-facing constants and pure helpers the screens share.
 * Nothing here is a hand-written fetch type: the HTTP client is `hc<AppType>` (see `http.ts`).
 *
 * Runtime helpers are typed against the package (`Record<LabelKey, …>`, `satisfies`) so a
 * contract change that adds or renames a value fails the typecheck here instead of at runtime.
 */
export type * from '@footballos/contracts';
import type { LabelKey, PlanSectionKey, Role, ScheduledGame, Unit } from '@footballos/contracts';

/** Section templates per unit (CONTRACTS §11). Titles are the coach-facing names. */
export const PLAN_SECTION_TEMPLATES: Record<Unit, { key: PlanSectionKey; title: string }[]> = {
  offense: [
    { key: 'objectives', title: 'Objectives' },
    { key: 'personnel', title: 'Personnel' },
    { key: 'formations', title: 'Formations' },
    { key: 'runs', title: 'Runs' },
    { key: 'passes', title: 'Passes' },
    { key: 'protections', title: 'Protections' },
    { key: 'opening_script', title: 'Opening script' },
    { key: 'third_down', title: 'Third down' },
    { key: 'red_zone', title: 'Red zone' },
    { key: 'short_yardage', title: 'Short yardage' },
    { key: 'two_minute', title: 'Two minute' },
  ],
  defense: [
    { key: 'opponent_tendencies', title: 'Opponent tendencies' },
    { key: 'fronts', title: 'Fronts' },
    { key: 'fits', title: 'Fits' },
    { key: 'coverages', title: 'Coverages' },
    { key: 'pressures', title: 'Pressures' },
    { key: 'matchups', title: 'Matchups' },
    { key: 'third_down', title: 'Third down' },
    { key: 'red_zone', title: 'Red zone' },
    { key: 'short_yardage', title: 'Short yardage' },
    { key: 'two_minute', title: 'Two minute' },
  ],
  special_teams: [
    { key: 'kickoff_return', title: 'Kickoff and kickoff return' },
    { key: 'punt_protection_return', title: 'Punt protection and return' },
    { key: 'fg_pat', title: 'Field goal and PAT' },
    { key: 'opponent_alerts', title: 'Opponent alerts' },
    { key: 'special_situations', title: 'Special situations' },
  ],
};

export const UNIT_LABELS: Record<Unit, string> = {
  offense: 'Offense',
  defense: 'Defense',
  special_teams: 'Special teams',
};

export const ROLE_LABELS: Record<Role, string> = {
  head_coach: 'Head coach',
  coordinator: 'Coordinator',
  position_coach: 'Position coach',
  analyst: 'Analyst',
  viewer: 'Viewer',
};

/** Coach-facing names for every label key (CONTRACTS §6). The record type keeps it complete. */
export const LABEL_KEY_LABELS: Record<LabelKey, string> = {
  unit: 'Unit',
  play_type: 'Play type',
  formation_family: 'Formation',
  alignment: 'Alignment',
  personnel_estimate: 'Personnel',
  situation_down: 'Down',
  situation_distance: 'Distance',
  situation_field_position: 'Field position',
  hash: 'Hash',
  motion: 'Motion',
  result_visible: 'Result visible',
  special_teams_type: 'Special teams type',
};

/** Label keys in review-table order. */
export const LABEL_KEYS = Object.keys(LABEL_KEY_LABELS) as LabelKey[];

/** Keys that are never inferred from nothing: visible evidence (scoreboard, marker) or a coach only. */
export const EVIDENCE_ONLY_KEYS: readonly LabelKey[] = ['situation_down', 'situation_distance', 'situation_field_position'];

/** Season record (CONTRACTS §4): final games only, bye and canceled excluded. */
export function seasonRecord(games: ScheduledGame[]): { wins: number; losses: number; ties: number } {
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const game of games) {
    if (game.status !== 'final' || !game.result || game.kind === 'bye') continue;
    if (game.result.outcome === 'win') record.wins += 1;
    else if (game.result.outcome === 'loss') record.losses += 1;
    else record.ties += 1;
  }
  return record;
}
