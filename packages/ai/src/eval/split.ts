import { createHash } from "node:crypto";

export interface GameSplit {
  heldOutGameIds: string[];
  trainingGameIds: string[];
}

/**
 * Deterministic split by game. Held-out games are chosen by a seeded hash of the game id so
 * the same seed always yields the same split, and clips from one game never straddle the
 * boundary. At least one game is held out and one kept when there are two or more games.
 */
export function splitByGame(gameIds: Iterable<string>, opts: { heldOutFraction: number; seed: string }): GameSplit {
  const games = [...new Set(gameIds)].sort();
  if (!(opts.heldOutFraction > 0 && opts.heldOutFraction < 1)) throw new Error("heldOutFraction must be in (0, 1)");
  if (games.length < 2) return { heldOutGameIds: games, trainingGameIds: [] };
  const ranked = games
    .map((g) => ({ g, h: createHash("sha256").update(`${opts.seed}\u0000${g}`).digest("hex") }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.g);
  const k = Math.max(1, Math.min(games.length - 1, Math.round(games.length * opts.heldOutFraction)));
  const heldOut = new Set(ranked.slice(0, k));
  return {
    heldOutGameIds: games.filter((g) => heldOut.has(g)),
    trainingGameIds: games.filter((g) => !heldOut.has(g)),
  };
}

/** Explicit held-out list; everything else is training. */
export function splitExplicit(gameIds: Iterable<string>, heldOut: string[]): GameSplit {
  const games = [...new Set(gameIds)].sort();
  const set = new Set(heldOut);
  return { heldOutGameIds: games.filter((g) => set.has(g)), trainingGameIds: games.filter((g) => !set.has(g)) };
}
