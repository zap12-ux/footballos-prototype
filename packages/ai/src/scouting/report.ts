/**
 * Scouting report (CONTRACTS §7, §14.6): the response body of
 * `GET /teams/:teamId/opponents/:opponentId/scouting` computed from stored records, and the
 * snapshot a coach can save. Pure functions: B's API loads the rows and persists snapshots.
 */
import { createHash, randomUUID } from "node:crypto";
import { UnitSchema, type MediaAsset, type ScheduledGame } from "@footballos/contracts";
import { COMPUTE_VERSION, computeFindings } from "../stats/findings.js";
import { indexLabels, resolveLabelValue, segmentExclusion, type StatSegment } from "../stats/resolve.js";
import type { Label, PlaySegment, ReportSnapshot, ReviewBasis, ScoutingFinding, Unit } from "../types.js";

/** The parts of a game the report needs. */
export type ReportGame = Pick<ScheduledGame, "id" | "opponentId">;
/** The parts of an asset the report needs. */
export type ReportAsset = Pick<MediaAsset, "id" | "gameId" | "status" | "context">;

export interface BuildScoutingReportInput {
  teamId: string;
  opponentId: string;
  unit: Unit;
  reviewBasis: ReviewBasis;
  /** The team's games (any opponent); only this opponent's games are used. */
  games: ReportGame[];
  /** Optional `gameIds=` filter from the route: restrict to these games. */
  gameIds?: string[] | null;
  /** Assets of those games; only `context.analyzedTeam === 'opponent'` film counts. */
  assets: ReportAsset[];
  /** Segments of those assets (superseded ones are excluded by the statistics). */
  segments: PlaySegment[];
  labels: Label[];
  /** Injected for deterministic tests. */
  now?: () => Date;
}

export interface ReportGameEntry {
  gameId: string;
  /** Opponent film of that game that the findings draw on (empty when none is usable). */
  assetIds: string[];
}

/** §14.6 response body (plus the identifiers and `inputsHash` a snapshot needs). */
export interface ScoutingReport {
  teamId: string;
  opponentId: string;
  unit: Unit;
  reviewBasis: ReviewBasis;
  findings: ScoutingFinding[];
  games: ReportGameEntry[];
  /** Segments of this unit eligible under the review basis (the plays the report draws on). */
  sampleSize: number;
  computedAt: string;
  computeVersion: string;
  /** sha256 over the identities and versions of every input row and the parameters. */
  inputsHash: string;
}

/** Asset statuses whose segments must not feed a report. */
const UNUSABLE_ASSET_STATUSES: ReadonlySet<MediaAsset["status"]> = new Set(["deleted", "rejected"]);

/**
 * The unit a segment belongs to: the coach's (or, under `includes_inferred`, the model's)
 * `unit` label when it names a unit; otherwise the asset's `analyzedUnit` unless that is
 * `mixed`; otherwise unknown. A unit is never guessed.
 */
export function segmentUnit(asset: ReportAsset, labelsByKey: Map<Label["key"], Label> | undefined, basis: ReviewBasis): Unit | null {
  const resolved = resolveLabelValue(labelsByKey?.get("unit"), basis);
  if (resolved.value !== null) {
    const parsed = UnitSchema.safeParse(resolved.value);
    if (parsed.success) return parsed.data;
  }
  const fromAsset = asset.context.analyzedUnit;
  return fromAsset === "mixed" ? null : fromAsset;
}

function hashInputs(input: BuildScoutingReportInput, games: ReportGameEntry[], segments: PlaySegment[], labels: Label[]): string {
  const h = createHash("sha256");
  const canon = {
    computeVersion: COMPUTE_VERSION,
    teamId: input.teamId,
    opponentId: input.opponentId,
    unit: input.unit,
    reviewBasis: input.reviewBasis,
    games: games.map((g) => ({ gameId: g.gameId, assetIds: [...g.assetIds].sort() })),
    segments: segments.map((s) => [s.id, s.version]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    labels: labels.map((l) => [l.id, l.version]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  h.update(JSON.stringify(canon));
  return h.digest("hex");
}

export function buildScoutingReport(input: BuildScoutingReportInput): ScoutingReport {
  const { teamId, opponentId, unit, reviewBasis } = input;
  if (!teamId || !opponentId) throw new TypeError("teamId and opponentId are required");
  if (!UnitSchema.safeParse(unit).success) throw new TypeError(`unit must be one of ${UnitSchema.options.join("|")}`);
  if (reviewBasis !== "reviewed_only" && reviewBasis !== "includes_inferred") throw new TypeError("reviewBasis must be reviewed_only|includes_inferred");
  const now = input.now ?? (() => new Date());

  const wanted = input.gameIds && input.gameIds.length > 0 ? new Set(input.gameIds) : null;
  const games = input.games.filter((g) => g.opponentId === opponentId && (!wanted || wanted.has(g.id)));
  const gameIds = new Set(games.map((g) => g.id));

  const assetsById = new Map<string, ReportAsset>();
  for (const a of input.assets) {
    if (!gameIds.has(a.gameId)) continue;
    if (a.context.analyzedTeam !== "opponent") continue;
    if (UNUSABLE_ASSET_STATUSES.has(a.status)) continue;
    assetsById.set(a.id, a);
  }

  const segments = input.segments.filter((s) => assetsById.has(s.assetId));
  const segmentIds = new Set(segments.map((s) => s.id));
  const labels = input.labels.filter((l) => segmentIds.has(l.segmentId));
  const byKey = indexLabels(labels);

  const statSegments: StatSegment[] = segments.map((s) => ({
    id: s.id,
    gameId: s.gameId,
    unit: segmentUnit(assetsById.get(s.assetId) as ReportAsset, byKey.get(s.id), reviewBasis),
    reviewStatus: s.reviewStatus,
    supersededBy: s.supersededBy,
  }));

  const findings = computeFindings(statSegments, labels, { teamId, opponentId, unit, reviewBasis, now });
  const sampleSize = statSegments.filter((s) => segmentExclusion(s, reviewBasis, unit) === null).length;

  const gameEntries: ReportGameEntry[] = games.map((g) => ({
    gameId: g.id,
    assetIds: [...assetsById.values()].filter((a) => a.gameId === g.id).map((a) => a.id),
  }));

  return {
    teamId,
    opponentId,
    unit,
    reviewBasis,
    findings,
    games: gameEntries,
    sampleSize,
    computedAt: now().toISOString(),
    computeVersion: COMPUTE_VERSION,
    inputsHash: hashInputs(input, gameEntries, segments, labels),
  };
}

export interface SnapshotOptions {
  now?: () => Date;
  newId?: () => string;
}

/** Freeze a report as a `ReportSnapshot` (§7) for `POST …/scouting/snapshots`. */
export function snapshotFromReport(report: ScoutingReport, title: string, generatedBy: string, opts: SnapshotOptions = {}): ReportSnapshot {
  const t = typeof title === "string" ? title.trim() : "";
  if (t === "" || t.length > 200) throw new TypeError("title must be 1–200 characters");
  if (typeof generatedBy !== "string" || generatedBy === "") throw new TypeError("generatedBy is required");
  if (typeof report.inputsHash !== "string" || report.inputsHash === "") throw new TypeError("report.inputsHash is required");
  return {
    id: (opts.newId ?? randomUUID)(),
    teamId: report.teamId,
    opponentId: report.opponentId,
    title: t,
    findings: report.findings.map((f) => ({ ...f, gameIds: [...f.gameIds], includedSegmentIds: [...f.includedSegmentIds], excludedSegmentIds: [...f.excludedSegmentIds] })),
    generatedBy,
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    inputsHash: report.inputsHash,
  };
}
