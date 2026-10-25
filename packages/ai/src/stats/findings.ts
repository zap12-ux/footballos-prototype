import { createHash } from "node:crypto";
import type { EvidenceRef, FindingKind, Label, LabelKey, ReviewBasis, ScoutingFinding, Unit } from "../types.js";
import { indexLabels, resolveLabelValue, segmentExclusion, type ExclusionReason, type StatSegment } from "./resolve.js";

export const COMPUTE_VERSION = "stats-0.1.0";

export interface StatsOptions {
  teamId: string;
  opponentId: string;
  /** Findings are per unit; a `mixed` asset contributes segments only through a per-segment unit. */
  unit: Unit;
  reviewBasis: ReviewBasis;
  /** Injected for deterministic tests. */
  now?: () => Date;
  /** Cap on evidence refs copied into a finding. */
  maxEvidence?: number;
}

export const SITUATION_KEYS: readonly LabelKey[] = ["situation_down", "situation_distance", "situation_field_position", "hash"];

interface Row {
  segmentId: string;
  gameId: string;
  values: Partial<Record<LabelKey, string>>;
  evidence: Partial<Record<LabelKey, EvidenceRef[]>>;
  /** First exclusion reason per key (only for keys that were asked for). */
  keyExclusions: Partial<Record<LabelKey, ExclusionReason>>;
}

interface Prepared {
  rows: Row[];
  /** Segments excluded before any label is consulted. */
  segmentExcluded: Record<string, ExclusionReason>;
  gameIds: string[];
}

function prepare(segments: StatSegment[], labels: Label[], keys: LabelKey[], opts: StatsOptions): Prepared {
  const idx = indexLabels(labels);
  const rows: Row[] = [];
  const segmentExcluded: Record<string, ExclusionReason> = {};
  const games = new Set<string>();
  for (const seg of segments) {
    games.add(seg.gameId);
    const ex = segmentExclusion(seg, opts.reviewBasis, opts.unit);
    if (ex) {
      segmentExcluded[seg.id] = ex;
      continue;
    }
    const row: Row = { segmentId: seg.id, gameId: seg.gameId, values: {}, evidence: {}, keyExclusions: {} };
    const byKey = idx.get(seg.id);
    for (const key of keys) {
      const r = resolveLabelValue(byKey?.get(key), opts.reviewBasis);
      if (r.excluded) row.keyExclusions[key] = r.excluded;
      else {
        row.values[key] = r.value as string;
        row.evidence[key] = r.evidence;
      }
    }
    rows.push(row);
  }
  return { rows, segmentExcluded, gameIds: [...games].sort() };
}

function findingId(parts: string[]): string {
  return "finding_" + createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
}

function percentOf(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function collectEvidence(rows: Row[], key: LabelKey, cap: number): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const r of rows) {
    for (const e of r.evidence[key] ?? []) {
      if (out.length >= cap) return out;
      out.push(e);
    }
  }
  return out;
}

function build(
  kind: FindingKind,
  statement: string,
  idParts: string[],
  numeratorRows: Row[],
  denominatorRows: Row[],
  excluded: Record<string, string>,
  prepared: Prepared,
  evidenceKey: LabelKey,
  opts: StatsOptions,
): ScoutingFinding {
  const now = (opts.now ?? (() => new Date()))();
  const excludedAll: Record<string, string> = { ...prepared.segmentExcluded, ...excluded };
  return {
    id: findingId([kind, opts.teamId, opts.opponentId, opts.unit, opts.reviewBasis, ...idParts]),
    teamId: opts.teamId,
    opponentId: opts.opponentId,
    gameIds: prepared.gameIds,
    unit: opts.unit,
    kind,
    statement,
    numerator: numeratorRows.length,
    denominator: denominatorRows.length,
    percent: percentOf(numeratorRows.length, denominatorRows.length),
    sampleSize: denominatorRows.length,
    includedSegmentIds: denominatorRows.map((r) => r.segmentId),
    excludedSegmentIds: Object.keys(excludedAll).sort(),
    excludedReason: excludedAll,
    reviewBasis: opts.reviewBasis,
    supportingEvidence: collectEvidence(numeratorRows, evidenceKey, opts.maxEvidence ?? 10),
    contraryEvidence: collectEvidence(
      denominatorRows.filter((r) => !numeratorRows.includes(r)),
      evidenceKey,
      opts.maxEvidence ?? 10,
    ),
    computedAt: now.toISOString(),
    computeVersion: COMPUTE_VERSION,
  };
}

function basisPhrase(b: ReviewBasis): string {
  return b === "reviewed_only" ? "coach-reviewed labels only" : "including unreviewed model labels";
}

/** How often each formation family appears: n of N plays with a known formation. */
export function formationFrequency(segments: StatSegment[], labels: Label[], opts: StatsOptions): ScoutingFinding[] {
  const prepared = prepare(segments, labels, ["formation_family"], opts);
  const known = prepared.rows.filter((r) => r.values.formation_family !== undefined);
  const excluded: Record<string, string> = {};
  for (const r of prepared.rows) if (r.keyExclusions.formation_family) excluded[r.segmentId] = r.keyExclusions.formation_family;
  const formations = [...new Set(known.map((r) => r.values.formation_family as string))].sort();
  return formations.map((f) => {
    const num = known.filter((r) => r.values.formation_family === f);
    return build(
      "formation_frequency",
      `${opts.unit} lined up in "${f}" on ${num.length} of ${known.length} plays with a known formation (${basisPhrase(opts.reviewBasis)}).`,
      [f],
      num,
      known,
      excluded,
      prepared,
      "formation_family",
      opts,
    );
  });
}

/** For each formation, the split of play types among plays where both are known. */
export function playTypeByFormation(segments: StatSegment[], labels: Label[], opts: StatsOptions): ScoutingFinding[] {
  const prepared = prepare(segments, labels, ["formation_family", "play_type"], opts);
  const excluded: Record<string, string> = {};
  const known = prepared.rows.filter((r) => {
    const ok = r.values.formation_family !== undefined && r.values.play_type !== undefined;
    if (!ok) excluded[r.segmentId] = r.keyExclusions.formation_family ?? r.keyExclusions.play_type ?? "unknown";
    return ok;
  });
  const out: ScoutingFinding[] = [];
  const formations = [...new Set(known.map((r) => r.values.formation_family as string))].sort();
  for (const f of formations) {
    const inFormation = known.filter((r) => r.values.formation_family === f);
    const types = [...new Set(inFormation.map((r) => r.values.play_type as string))].sort();
    for (const t of types) {
      const num = inFormation.filter((r) => r.values.play_type === t);
      out.push(
        build(
          "play_type_by_formation",
          `From "${f}", ${opts.unit} ran "${t}" on ${num.length} of ${inFormation.length} plays with a known play type (${basisPhrase(opts.reviewBasis)}).`,
          [f, t],
          num,
          inFormation,
          excluded,
          prepared,
          "play_type",
          opts,
        ),
      );
    }
  }
  return out;
}

/**
 * Play-type tendency by each available situation key (down, distance, field position,
 * hash). Only situation values that are actually present are reported; a key with no known
 * values produces no findings rather than a fabricated one.
 */
export function tendencyBySituation(
  segments: StatSegment[],
  labels: Label[],
  opts: StatsOptions,
  situationKeys: readonly LabelKey[] = SITUATION_KEYS,
): ScoutingFinding[] {
  const prepared = prepare(segments, labels, ["play_type", ...situationKeys], opts);
  const out: ScoutingFinding[] = [];
  for (const sk of situationKeys) {
    const excluded: Record<string, string> = {};
    const known = prepared.rows.filter((r) => {
      const ok = r.values[sk] !== undefined && r.values.play_type !== undefined;
      if (!ok) excluded[r.segmentId] = r.keyExclusions[sk] ?? r.keyExclusions.play_type ?? "unknown";
      return ok;
    });
    const values = [...new Set(known.map((r) => r.values[sk] as string))].sort();
    for (const v of values) {
      const inSituation = known.filter((r) => r.values[sk] === v);
      const types = [...new Set(inSituation.map((r) => r.values.play_type as string))].sort();
      for (const t of types) {
        const num = inSituation.filter((r) => r.values.play_type === t);
        out.push(
          build(
            "tendency_by_situation",
            `With ${sk.replace("situation_", "").replace("_", " ")} = "${v}", ${opts.unit} ran "${t}" on ${num.length} of ${inSituation.length} plays with a known play type (${basisPhrase(opts.reviewBasis)}).`,
            [sk, v, t],
            num,
            inSituation,
            excluded,
            prepared,
            "play_type",
            opts,
          ),
        );
      }
    }
  }
  return out;
}

/** All deterministic findings for one unit. */
export function computeFindings(segments: StatSegment[], labels: Label[], opts: StatsOptions): ScoutingFinding[] {
  return [
    ...formationFrequency(segments, labels, opts),
    ...playTypeByFormation(segments, labels, opts),
    ...tendencyBySituation(segments, labels, opts),
  ];
}
