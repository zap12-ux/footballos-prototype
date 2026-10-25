/**
 * The matching table: which finding becomes which kind of recommendation for which plan unit,
 * and which installed playbook concept kinds may ground it. Mirrored in
 * `docs/ai/RECOMMENDATIONS.md` so coaches can see why a concept was suggested.
 */
import type { ConceptKind } from "@footballos/contracts";
import type { ScoutingFinding, Unit } from "../types.js";
import type { RecommendationType } from "./types.js";

/** A plan for our unit draws on the report about the opponent unit it faces. */
export const REPORT_UNIT_FOR_PLAN_UNIT: Readonly<Record<Unit, Unit>> = Object.freeze({
  defense: "offense",
  offense: "defense",
  special_teams: "special_teams",
});

export const CONCEPT_KINDS_BY_RECOMMENDATION: Readonly<Record<RecommendationType, readonly ConceptKind[]>> = Object.freeze({
  defend_formation: ["front", "coverage"],
  defend_run_tendency: ["front", "pressure"],
  defend_pass_tendency: ["coverage", "pressure"],
  defend_situation_run: ["front", "pressure"],
  defend_situation_pass: ["coverage", "pressure"],
  defend_general: ["front", "coverage", "pressure"],
  attack_defensive_look: ["run", "pass", "protection"],
  attack_general: ["run", "pass", "protection"],
  special_teams_look: ["special_teams"],
});

/** Dimension values of a finding, read back from the statement `stats/findings.ts` wrote. */
export interface FindingFacets {
  formation?: string;
  playType?: string;
  situationKey?: string;
  situationValue?: string;
}

const RE_FORMATION = /^(?:offense|defense|special_teams) lined up in "(.+?)" on \d+ of \d+ plays/;
const RE_PLAY_TYPE_BY_FORMATION = /^From "(.+?)", (?:offense|defense|special_teams) ran "(.+?)" on \d+ of \d+ plays/;
const RE_TENDENCY_BY_SITUATION = /^With (down|distance|field position|hash) = "(.+?)", (?:offense|defense|special_teams) ran "(.+?)" on \d+ of \d+ plays/;

const SITUATION_KEY_BY_PHRASE: Record<string, string> = { down: "situation_down", distance: "situation_distance", "field position": "situation_field_position", hash: "hash" };

/**
 * Parse the finding's dimensions from its statement. The statement templates live in this
 * package (`stats/findings.ts`); a finding whose statement does not match (another compute
 * version, a hand-edited snapshot) yields null and is skipped rather than guessed.
 */
export function findingFacets(f: Pick<ScoutingFinding, "kind" | "statement">): FindingFacets | null {
  switch (f.kind) {
    case "formation_frequency": {
      const m = RE_FORMATION.exec(f.statement);
      return m ? { formation: m[1] as string } : null;
    }
    case "play_type_by_formation": {
      const m = RE_PLAY_TYPE_BY_FORMATION.exec(f.statement);
      return m ? { formation: m[1] as string, playType: m[2] as string } : null;
    }
    case "tendency_by_situation": {
      const m = RE_TENDENCY_BY_SITUATION.exec(f.statement);
      return m ? { situationKey: SITUATION_KEY_BY_PHRASE[m[1] as string] as string, situationValue: m[2] as string, playType: m[3] as string } : null;
    }
    case "strength":
    case "weakness":
      return {};
    case "uncertain":
      return null;
  }
}

export interface Classification {
  type: RecommendationType;
  facets: FindingFacets;
}

/**
 * Which recommendation a finding can become for the given plan unit, or a reason it cannot.
 */
export function classifyFinding(f: Pick<ScoutingFinding, "kind" | "statement">, planUnit: Unit): { ok: true; value: Classification } | { ok: false; reason: string } {
  const facets = findingFacets(f);
  if (facets === null) {
    return { ok: false, reason: f.kind === "uncertain" ? "an 'uncertain' finding is never turned into a recommendation" : `the finding's dimensions could not be read from its statement (kind ${f.kind})` };
  }
  const playType = facets.playType;
  if (planUnit === "defense") {
    switch (f.kind) {
      case "formation_frequency":
        return { ok: true, value: { type: "defend_formation", facets } };
      case "play_type_by_formation":
        if (playType === "run") return { ok: true, value: { type: "defend_run_tendency", facets } };
        if (playType === "pass") return { ok: true, value: { type: "defend_pass_tendency", facets } };
        return { ok: false, reason: `play type "${playType}" has no concept mapping (only run and pass do)` };
      case "tendency_by_situation":
        if (playType === "run") return { ok: true, value: { type: "defend_situation_run", facets } };
        if (playType === "pass") return { ok: true, value: { type: "defend_situation_pass", facets } };
        return { ok: false, reason: `play type "${playType}" has no concept mapping (only run and pass do)` };
      default:
        return { ok: true, value: { type: "defend_general", facets } };
    }
  }
  if (planUnit === "offense") {
    switch (f.kind) {
      case "formation_frequency":
        return { ok: true, value: { type: "attack_defensive_look", facets } };
      case "play_type_by_formation":
      case "tendency_by_situation":
        return { ok: false, reason: "play-type tendencies describe an offense; this report is about the opponent defense" };
      default:
        return { ok: true, value: { type: "attack_general", facets } };
    }
  }
  switch (f.kind) {
    case "formation_frequency":
    case "strength":
    case "weakness":
      return { ok: true, value: { type: "special_teams_look", facets } };
    default:
      return { ok: false, reason: "play-type tendencies are not used for special teams" };
  }
}

/** Plain words for a situation key. */
export function situationLabel(key: string): string {
  switch (key) {
    case "situation_down":
      return "down";
    case "situation_distance":
      return "distance";
    case "situation_field_position":
      return "field position";
    case "hash":
      return "hash";
    default:
      return key;
  }
}
