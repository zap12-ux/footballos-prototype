import { describe, expect, it } from "vitest";
import { ReportSnapshotSchema, ScoutingFindingSchema } from "@footballos/contracts";
import { buildScoutingReport, snapshotFromReport, type Label, type PlaySegment, type ReportAsset, type ReportGame } from "../src/index.js";

const u = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const TEAM = u(1);
const OPP_X = u(2);
const OPP_Y = u(3);
const USER = u(4);
const g1 = u(11), g2 = u(12), g3 = u(13), g4 = u(14);
const a1 = u(21), a2 = u(22), a3 = u(23), a4 = u(24), a5 = u(25), a6 = u(26);
const s = (n: number) => u(100 + n);
const now = () => new Date("2026-10-25T15:00:00.000Z");

const games: ReportGame[] = [
  { id: g1, opponentId: OPP_X },
  { id: g2, opponentId: OPP_X },
  { id: g3, opponentId: OPP_Y },
  { id: g4, opponentId: OPP_X },
];

function asset(id: string, gameId: string, analyzedTeam: "us" | "opponent", analyzedUnit: ReportAsset["context"]["analyzedUnit"], status: ReportAsset["status"] = "ready"): ReportAsset {
  return { id, gameId, status, context: { analyzedTeam, analyzedUnit, perspective: "endzone", teamCues: null } };
}
const assets: ReportAsset[] = [
  asset(a1, g1, "opponent", "offense"),
  asset(a2, g1, "us", "offense"), // our own film: never part of an opponent report
  asset(a3, g2, "opponent", "mixed"), // unit must come from the coach's label
  asset(a4, g3, "opponent", "offense"), // other opponent
  asset(a5, g4, "opponent", "offense"), // filtered out by gameIds in the tests below
  asset(a6, g1, "opponent", "offense", "deleted"),
  { ...asset(u(27), g1, "opponent", "offense"), gameId: null }, // a document asset (§15.1): no game, never part of a report
];

function seg(id: string, assetId: string, gameId: string, extra: Partial<PlaySegment> = {}): PlaySegment {
  return { id, teamId: TEAM, assetId, gameId, index: 0, startSec: 0, endSec: 5, origin: "proposed", reviewStatus: "accepted", supersededBy: [], version: 1, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", ...extra };
}
const segments: PlaySegment[] = [
  seg(s(1), a1, g1),
  seg(s(2), a1, g1),
  seg(s(3), a3, g2),
  seg(s(4), a3, g2),
  seg(s(5), a2, g1),
  seg(s(6), a4, g3),
  seg(s(7), a5, g4),
  seg(s(8), a6, g1),
  seg(s(9), a1, g1, { reviewStatus: "proposed" }),
];

let n = 0;
function label(segmentId: string, key: Label["key"], value: string, status: Label["accepted"]["status"] = "accepted"): Label {
  const inferred = status === "unknown" ? null : { value, abstained: false, rationale: "seen", evidence: [{ assetId: a1, atSec: 1, toSec: null, frameIndex: 0, note: null }], uncertainty: "low" as const };
  return { id: u(500 + n++), teamId: TEAM, segmentId, key, inferred, accepted: { value: status === "inferred" ? value : value, status, byUserId: null, at: null }, provenanceId: null, version: 1, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z" };
}
const labels: Label[] = [
  label(s(1), "formation_family", "trips"),
  label(s(2), "formation_family", "trips", "corrected"),
  label(s(3), "unit", "offense"),
  label(s(3), "formation_family", "bunch"),
  label(s(4), "formation_family", "trips"), // no unit label on a mixed asset → unit unknown
  label(s(5), "formation_family", "trips"),
  label(s(6), "formation_family", "trips"),
  label(s(7), "formation_family", "trips"),
  label(s(8), "formation_family", "trips"),
  label(s(9), "formation_family", "trips", "inferred"),
];

describe("buildScoutingReport", () => {
  it("uses only this opponent's games and opponent film; hand-computed counts", () => {
    const r = buildScoutingReport({ teamId: TEAM, opponentId: OPP_X, unit: "offense", reviewBasis: "reviewed_only", games, assets, segments, labels, now });
    // Games: g1, g2, g4 belong to opponent X; g3 does not. a2 is our film, a6 is deleted.
    expect(r.games).toEqual([
      { gameId: g1, assetIds: [a1] },
      { gameId: g2, assetIds: [a3] },
      { gameId: g4, assetIds: [a5] },
    ]);
    // Eligible plays: s1, s2 (a1), s3 (a3 with coach unit), s7 (a5). s4 unit unknown, s9 unreviewed.
    expect(r.sampleSize).toBe(4);
    const ff = r.findings.filter((f) => f.kind === "formation_frequency");
    expect(ff.map((f) => [f.statement.match(/"(\w+)"/)![1], f.numerator, f.denominator, f.percent])).toEqual([
      ["bunch", 1, 4, 25],
      ["trips", 3, 4, 75],
    ]);
    expect(ff[0]!.includedSegmentIds.sort()).toEqual([s(1), s(2), s(3), s(7)].sort());
    expect(ff[0]!.excludedReason).toEqual({ [s(4)]: "unknown", [s(9)]: "unreviewed" });
    expect(ff[0]!.gameIds).toEqual([g1, g2, g4]);
    expect(ff[0]).toMatchObject({ teamId: TEAM, opponentId: OPP_X, unit: "offense", reviewBasis: "reviewed_only", computedAt: "2026-10-25T15:00:00.000Z" });
    expect(r).toMatchObject({ teamId: TEAM, opponentId: OPP_X, unit: "offense", reviewBasis: "reviewed_only", computedAt: "2026-10-25T15:00:00.000Z", computeVersion: "stats-0.1.0" });
    expect(r.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    for (const f of r.findings) expect(ScoutingFindingSchema.safeParse(f).success, JSON.stringify(ScoutingFindingSchema.safeParse(f))).toBe(true);
  });

  it("skips an asset with no game (a playbook document, §15.1) instead of failing", () => {
    const r = buildScoutingReport({ teamId: TEAM, opponentId: OPP_X, unit: "offense", reviewBasis: "reviewed_only", games, assets, segments: [...segments, seg(s(10), u(27), g1)], labels, now });
    expect(r.games.flatMap((g) => g.assetIds)).not.toContain(u(27));
    expect(r.findings.every((f) => !f.includedSegmentIds.includes(s(10)))).toBe(true);
  });

  it("honours the gameIds filter and includes_inferred changes the sample", () => {
    const r = buildScoutingReport({ teamId: TEAM, opponentId: OPP_X, unit: "offense", reviewBasis: "includes_inferred", games, assets, segments, labels, now, gameIds: [g1, g3] });
    expect(r.games).toEqual([{ gameId: g1, assetIds: [a1] }]);
    // s1, s2, s9 (inferred now counts); s7 is out of scope.
    expect(r.sampleSize).toBe(3);
    const trips = r.findings.find((f) => f.kind === "formation_frequency")!;
    expect([trips.numerator, trips.denominator]).toEqual([3, 3]);
    expect(trips.excludedReason).toEqual({});
  });

  it("reports a game with no usable film with an empty assetIds list and no findings", () => {
    const r = buildScoutingReport({ teamId: TEAM, opponentId: OPP_X, unit: "defense", reviewBasis: "reviewed_only", games, assets: [asset(a6, g1, "opponent", "defense", "deleted")], segments, labels, now });
    expect(r.games).toEqual([{ gameId: g1, assetIds: [] }, { gameId: g2, assetIds: [] }, { gameId: g4, assetIds: [] }]);
    expect(r.findings).toEqual([]);
    expect(r.sampleSize).toBe(0);
  });

  it("inputsHash changes with a label version, a parameter or the set of rows, and is stable otherwise", () => {
    const base = { teamId: TEAM, opponentId: OPP_X, unit: "offense" as const, reviewBasis: "reviewed_only" as const, games, assets, segments, labels, now };
    const h = buildScoutingReport(base).inputsHash;
    expect(buildScoutingReport({ ...base, now: () => new Date("2027-01-01T00:00:00.000Z") }).inputsHash).toBe(h);
    expect(buildScoutingReport({ ...base, labels: labels.map((l, i) => (i === 0 ? { ...l, version: 2 } : l)) }).inputsHash).not.toBe(h);
    expect(buildScoutingReport({ ...base, reviewBasis: "includes_inferred" }).inputsHash).not.toBe(h);
    expect(buildScoutingReport({ ...base, gameIds: [g1] }).inputsHash).not.toBe(h);
    // Rows outside the opponent's scope do not affect the hash.
    expect(buildScoutingReport({ ...base, labels: labels.filter((l) => l.segmentId !== s(6)) }).inputsHash).toBe(h);
  });

  it("validates parameters", () => {
    const base = { teamId: TEAM, opponentId: OPP_X, games, assets, segments, labels };
    expect(() => buildScoutingReport({ ...base, unit: "mixed" as never, reviewBasis: "reviewed_only" })).toThrow(/unit/);
    expect(() => buildScoutingReport({ ...base, unit: "offense", reviewBasis: "all" as never })).toThrow(/reviewBasis/);
  });
});

describe("snapshotFromReport", () => {
  it("produces a contract-valid ReportSnapshot carrying the report's findings and inputsHash", () => {
    const r = buildScoutingReport({ teamId: TEAM, opponentId: OPP_X, unit: "offense", reviewBasis: "reviewed_only", games, assets, segments, labels, now });
    const snap = snapshotFromReport(r, "  Week 9 — opponent offense  ", USER, { now, newId: () => u(900) });
    expect(snap).toMatchObject({ id: u(900), teamId: TEAM, opponentId: OPP_X, title: "Week 9 — opponent offense", generatedBy: USER, generatedAt: "2026-10-25T15:00:00.000Z", inputsHash: r.inputsHash });
    expect(snap.findings).toEqual(r.findings);
    expect(snap.findings[0]).not.toBe(r.findings[0]);
    const parsed = ReportSnapshotSchema.safeParse(snap);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    expect(() => snapshotFromReport(r, "", USER)).toThrow(/title/);
    expect(() => snapshotFromReport(r, "x".repeat(201), USER)).toThrow(/title/);
    expect(() => snapshotFromReport(r, "ok", "")).toThrow(/generatedBy/);
  });
});
