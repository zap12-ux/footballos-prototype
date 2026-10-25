import { createHash } from "node:crypto";

export interface GameSplit {
  heldOutGameIds: string[];
  developmentGameIds: string[];
}

/**
 * Deterministic split by game. Every clip of a game lands on the same side, so a model
 * (or prompt) tuned on the development games is never scored on clips it has seen.
 * `heldOutFraction` picks games by a seeded hash; `heldOutGameIds` overrides it.
 */
export function splitByGame(
  gameIds: Iterable<string>,
  opts: { heldOutGameIds?: string[]; heldOutFraction?: number; seed?: string },
): GameSplit {
  const games = [...new Set(gameIds)].sort();
  if (opts.heldOutGameIds && opts.heldOutGameIds.length > 0) {
    const held = new Set(opts.heldOutGameIds);
    for (const g of held) if (!games.includes(g)) throw new Error(`held-out game ${g} is not in the data`);
    return { heldOutGameIds: games.filter((g) => held.has(g)), developmentGameIds: games.filter((g) => !held.has(g)) };
  }
  const fraction = opts.heldOutFraction ?? 0.3;
  if (!(fraction > 0 && fraction < 1)) throw new Error("heldOutFraction must be in (0,1)");
  const seed = opts.seed ?? "footballos";
  const ranked = games
    .map((g) => ({ g, h: createHash("sha256").update(`${seed}\u0000${g}`).digest("hex") }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.g);
  const n = Math.max(1, Math.round(games.length * fraction));
  const held = new Set(ranked.slice(0, Math.min(n, games.length - (games.length > 1 ? 1 : 0))));
  return { heldOutGameIds: games.filter((g) => held.has(g)), developmentGameIds: games.filter((g) => !held.has(g)) };
}

/** Throws when any segment id appears in both groups (clip leakage). */
export function assertNoClipLeakage(records: { segmentId: string; gameId: string }[], split: GameSplit): void {
  const held = new Set(split.heldOutGameIds);
  const dev = new Set(split.developmentGameIds);
  const inHeld = new Set<string>();
  const inDev = new Set<string>();
  for (const r of records) {
    if (held.has(r.gameId)) inHeld.add(r.segmentId);
    else if (dev.has(r.gameId)) inDev.add(r.segmentId);
  }
  for (const s of inHeld) if (inDev.has(s)) throw new Error(`segment ${s} appears in both held-out and development games`);
}
