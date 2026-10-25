/**
 * Default keyword vocabulary used to guess a concept's `kind` from its name (CONTRACTS §8
 * kinds). A guess is only a starting point for the reviewing coach; a team's own vocabulary
 * (passed to `proposeFromPages`) is merged over this one and wins on conflicts.
 */
import { ConceptKindSchema, type ConceptKind } from "@footballos/contracts";
import type { ConceptVocabulary } from "./types.js";

export const DEFAULT_CONCEPT_VOCABULARY: Readonly<Required<ConceptVocabulary>> = Object.freeze({
  run: ["inside zone", "outside zone", "split zone", "zone read", "power", "counter", "trap", "sweep", "draw", "iso", "dive", "toss", "stretch", "duo", "wham", "lead", "option", "read", "qb run", "jet", "pin and pull", "pin & pull", "buck", "belly", "crack", "gap scheme", "run game", "runs"],
  pass: ["pass", "slant", "curl", "flat", "vertical", "verticals", "seam", "post", "corner", "fade", "screen", "mesh", "smash", "flood", "dig", "drag", "wheel", "bubble", "hitch", "snag", "stick", "sail", "levels", "shallow", "spot", "y-cross", "cross", "boot", "naked", "play action", "play-action", "rpo", "dropback", "quick game", "passes"],
  protection: ["protection", "protections", "pro", "slide", "half slide", "half-slide", "bob", "big on big", "max protect", "6-man", "7-man", "five man", "six man", "seven man", "turnback", "sprint out", "hinge"],
  front: ["front", "fronts", "over", "under", "bear", "okie", "4-3", "3-4", "4-2-5", "3-3-5", "4-4", "5-2", "6-1", "eagle", "tite", "mint", "even", "odd", "wide", "stack", "fits", "run fit", "run fits", "gap control"],
  coverage: ["coverage", "coverages", "cover 0", "cover 1", "cover 2", "cover 3", "cover 4", "cover 6", "cover zero", "cover one", "cover two", "cover three", "cover four", "cover six", "quarters", "palms", "man", "press", "tampa", "robber", "bracket", "match", "zone coverage", "sky", "cloud", "buzz", "invert", "2-man", "2 man"],
  pressure: ["pressure", "pressures", "blitz", "fire zone", "dog", "stunt", "twist", "sim", "creeper", "overload", "zero blitz", "edge pressure", "cross dog"],
  special_teams: ["punt", "kickoff", "kick off", "kick return", "punt return", "field goal", "pat", "fg", "onside", "fake", "return", "special teams", "hands team", "safe punt", "block"],
  formation: ["formation", "formations", "trips", "doubles", "bunch", "empty", "i-form", "i form", "pistol", "shotgun", "gun", "spread", "wing", "ace", "heavy", "jumbo", "trey", "deuce", "twins", "slot", "tight", "pro set", "wishbone", "flexbone", "personnel", "10 personnel", "11 personnel", "12 personnel", "21 personnel", "22 personnel"],
  other: [],
});

const WORD_CHAR = /[a-z0-9]/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Merge a team vocabulary over the defaults (team phrases are tried first for each kind). */
export function mergeVocabulary(custom?: ConceptVocabulary): Required<ConceptVocabulary> {
  const out = {} as Required<ConceptVocabulary>;
  for (const kind of ConceptKindSchema.options) {
    const own = (custom?.[kind] ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    out[kind] = [...own, ...DEFAULT_CONCEPT_VOCABULARY[kind]];
  }
  return out;
}

interface Hit {
  kind: ConceptKind;
  phrase: string;
  /** Phrases from the team vocabulary rank above defaults. */
  custom: boolean;
  index: number;
}

/**
 * Guess a kind from a name (and optionally its description). The longest matching phrase
 * wins, so "zone coverage" beats "zone" and "inside zone" beats "zone"; a team phrase beats a
 * default phrase of the same length; a match in the name beats one in the description. When
 * nothing matches, the section's kind (a heading such as "Protections") is used, else `other`.
 */
export function guessKind(name: string, opts: { description?: string; vocabulary?: Required<ConceptVocabulary>; sectionKind?: ConceptKind | null; custom?: ConceptVocabulary } = {}): ConceptKind {
  const vocab = opts.vocabulary ?? mergeVocabulary(opts.custom);
  const fromName = bestHit(name, vocab, opts.custom);
  if (fromName) return fromName.kind;
  if (opts.description) {
    const fromDesc = bestHit(opts.description, vocab, opts.custom);
    if (fromDesc) return fromDesc.kind;
  }
  return opts.sectionKind ?? "other";
}

function bestHit(text: string, vocab: Required<ConceptVocabulary>, custom?: ConceptVocabulary): Hit | null {
  const hay = text.toLowerCase();
  let best: Hit | null = null;
  for (const kind of ConceptKindSchema.options) {
    const customSet = new Set((custom?.[kind] ?? []).map((s) => s.trim().toLowerCase()));
    for (const phrase of vocab[kind]) {
      const p = phrase.toLowerCase();
      if (p.length === 0) continue;
      // Whole-word match: a phrase boundary must not be a letter or digit.
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}(?=$|[^a-z0-9])`, "i");
      const m = re.exec(hay);
      if (!m) continue;
      const hit: Hit = { kind, phrase: p, custom: customSet.has(p), index: m.index };
      if (!best || p.length > best.phrase.length || (p.length === best.phrase.length && hit.custom && !best.custom)) best = hit;
    }
  }
  return best && WORD_CHAR.test(best.phrase) ? best : null;
}

/** Kind implied by a section heading ("Run Game", "Protections", "Fronts", "Terms" → null). */
export function sectionKindFromHeading(heading: string, vocab: Required<ConceptVocabulary>): ConceptKind | null {
  const h = heading.toLowerCase();
  if (/\b(terms?|glossary|definitions?|vocabulary)\b/.test(h)) return null;
  const hit = bestHit(h, vocab);
  return hit?.kind ?? null;
}
