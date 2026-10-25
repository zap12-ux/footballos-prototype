import { readFileSync } from "node:fs";
import type { PredictionRow, TruthRow } from "./types.js";

export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`line ${i + 1}: invalid JSON (${(err as Error).message})`);
    }
  }
  return out;
}

function str(v: unknown, field: string, line: number): string {
  if (typeof v !== "string" || v === "") throw new Error(`line ${line}: "${field}" must be a non-empty string`);
  return v;
}

export function parseTruthRows(text: string): TruthRow[] {
  return parseJsonl(text).map((row, i) => {
    const r = row as Record<string, unknown>;
    const value = r.value;
    if (value !== null && typeof value !== "string") throw new Error(`line ${i + 1}: "value" must be a string or null`);
    return { segmentId: str(r.segmentId, "segmentId", i + 1), gameId: str(r.gameId, "gameId", i + 1), key: str(r.key, "key", i + 1), value: value as string | null };
  });
}

export function parsePredictionRows(text: string): PredictionRow[] {
  return parseJsonl(text).map((row, i) => {
    const r = row as Record<string, unknown>;
    const value = r.value;
    if (value !== null && typeof value !== "string") throw new Error(`line ${i + 1}: "value" must be a string or null`);
    if (typeof r.abstained !== "boolean") throw new Error(`line ${i + 1}: "abstained" must be a boolean`);
    if (r.abstained && value !== null) throw new Error(`line ${i + 1}: an abstained prediction must have value null`);
    return {
      segmentId: str(r.segmentId, "segmentId", i + 1),
      gameId: str(r.gameId, "gameId", i + 1),
      key: str(r.key, "key", i + 1),
      value: value as string | null,
      abstained: r.abstained,
    };
  });
}

export function readTruthFile(path: string): TruthRow[] {
  return parseTruthRows(readFileSync(path, "utf8"));
}
export function readPredictionFile(path: string): PredictionRow[] {
  return parsePredictionRows(readFileSync(path, "utf8"));
}
