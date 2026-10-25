import { describe, expect, it } from "vitest";
import { computeFindings, formationFrequency, playTypeByFormation, tendencyBySituation, type Label, type StatSegment } from "../src/index.js";

const now = () => new Date("2026-10-25T12:00:00Z");
const base = { teamId: "team_demo", opponentId: "opp_demo", unit: "offense" as const, now };

function seg(id: string, extra: Partial<StatSegment> = {}): StatSegment {
  return { id, gameId: "g1", unit: "offense", reviewStatus: "accepted", supersededBy: [], ...extra };
}
let n = 0;
function label(segmentId: string, key: Label["key"], opts: { inferred?: string | null; abstained?: boolean; accepted?: string | null; status: Label["accepted"]["status"] }): Label {
  n++;
  return {
    id: `l${n}`, teamId: "team_demo", segmentId, key, version: 1, provenanceId: null, createdAt: "", updatedAt: "",
    inferred: opts.inferred === undefined ? null : { value: opts.inferred, abstained: opts.abstained ?? false, rationale: "r", evidence: [{ assetId: "a", atSec: 1, toSec: null, frameIndex: 0, note: null }], uncertainty: "low" },
    accepted: { value: opts.accepted ?? null, status: opts.status, byUserId: null, at: null },
  };
}

/*
 Hand-computed fixture (offense, one game):
   s1: formation trips (coach accepted), play pass (accepted)             down 1 (accepted)
   s2: formation trips (coach corrected from doubles), play run (accepted) down 1 (accepted)
   s3: formation doubles (inferred only), play run (inferred only)        down 2 (inferred only)
   s4: formation unknown (status unknown), play pass (accepted)           down null
   s5: formation trips (accepted), play rejected label                    down 1 (accepted)
   s6: segment rejected by coach (has labels)                             -
   s7: segment proposed, never reviewed, formation trips inferred         -
   s8: defense segment (other unit)
*/
const segments: StatSegment[] = [
  seg("s1"), seg("s2"), seg("s3", { reviewStatus: "accepted" }), seg("s4"), seg("s5"),
  seg("s6", { reviewStatus: "rejected" }), seg("s7", { reviewStatus: "proposed" }), seg("s8", { unit: "defense" }),
];
const labels: Label[] = [
  label("s1", "formation_family", { inferred: "trips", accepted: "trips", status: "accepted" }),
  label("s1", "play_type", { inferred: "pass", accepted: "pass", status: "accepted" }),
  label("s1", "situation_down", { accepted: "1", status: "accepted" }),
  label("s2", "formation_family", { inferred: "doubles", accepted: "trips", status: "corrected" }),
  label("s2", "play_type", { inferred: "run", accepted: "run", status: "accepted" }),
  label("s2", "situation_down", { accepted: "1", status: "accepted" }),
  label("s3", "formation_family", { inferred: "doubles", status: "inferred" }),
  label("s3", "play_type", { inferred: "run", status: "inferred" }),
  label("s3", "situation_down", { inferred: "2", status: "inferred" }),
  label("s4", "formation_family", { inferred: null, abstained: true, status: "unknown" }),
  label("s4", "play_type", { inferred: "pass", accepted: "pass", status: "accepted" }),
  label("s5", "formation_family", { inferred: "trips", accepted: "trips", status: "accepted" }),
  label("s5", "play_type", { inferred: "pass", status: "rejected" }),
  label("s5", "situation_down", { accepted: "1", status: "accepted" }),
  label("s6", "formation_family", { inferred: "trips", accepted: "trips", status: "accepted" }),
  label("s7", "formation_family", { inferred: "trips", status: "inferred" }),
  label("s8", "formation_family", { inferred: "trips", accepted: "trips", status: "accepted" }),
];

describe("formationFrequency", () => {
  it("reviewed_only: trips 3 of 3 known; s3/s4 unknown, s6 rejected, s7 unreviewed, s8 other unit", () => {
    const f = formationFrequency(segments, labels, { ...base, reviewBasis: "reviewed_only" });
    expect(f).toHaveLength(1);
    const trips = f[0]!;
    expect(trips).toMatchObject({ kind: "formation_frequency", numerator: 3, denominator: 3, percent: 100, sampleSize: 3, reviewBasis: "reviewed_only", unit: "offense", gameIds: ["g1"] });
    expect(trips.includedSegmentIds).toEqual(["s1", "s2", "s5"]);
    expect(trips.excludedReason).toEqual({ s3: "unreviewed", s4: "unknown", s6: "rejected", s7: "unreviewed", s8: "other_unit" });
    expect(trips.excludedSegmentIds).toEqual(["s3", "s4", "s6", "s7", "s8"]);
    expect(trips.statement).toBe('offense lined up in "trips" on 3 of 3 plays with a known formation (coach-reviewed labels only).');
    expect(trips.supportingEvidence).toHaveLength(3);
    expect(trips.computedAt).toBe("2026-10-25T12:00:00.000Z");
  });

  it("includes_inferred: trips 4 of 5 and doubles 1 of 5; s7 (proposed, inferred) now counts", () => {
    const f = formationFrequency(segments, labels, { ...base, reviewBasis: "includes_inferred" });
    expect(f.map((x) => [x.statement.match(/"(.+?)"/)![1], x.numerator, x.denominator, x.percent])).toEqual([
      ["doubles", 1, 5, 20],
      ["trips", 4, 5, 80],
    ]);
    expect(f[1]!.includedSegmentIds).toEqual(["s1", "s2", "s3", "s5", "s7"]);
    expect(f[1]!.excludedReason).toEqual({ s4: "unknown", s6: "rejected", s8: "other_unit" });
    // the corrected label uses the coach's value, not the model's "doubles"
    expect(f[0]!.includedSegmentIds).toContain("s2");
    expect(f[0]!.supportingEvidence.length).toBe(1);
  });

  it("percent is null when the denominator is zero and ids are deterministic", () => {
    const none = formationFrequency([seg("x")], [], { ...base, reviewBasis: "reviewed_only" });
    expect(none).toEqual([]);
    const a = formationFrequency(segments, labels, { ...base, reviewBasis: "reviewed_only" })[0]!.id;
    const b = formationFrequency(segments, labels, { ...base, reviewBasis: "reviewed_only" })[0]!.id;
    expect(a).toBe(b);
    expect(a).not.toBe(formationFrequency(segments, labels, { ...base, reviewBasis: "includes_inferred" })[0]!.id);
  });
});

describe("playTypeByFormation", () => {
  it("reviewed_only: trips → pass 1 of 2, run 1 of 2; s5 excluded because its play type was rejected", () => {
    const f = playTypeByFormation(segments, labels, { ...base, reviewBasis: "reviewed_only" });
    expect(f.map((x) => [x.numerator, x.denominator, x.percent])).toEqual([[1, 2, 50], [1, 2, 50]]);
    expect(f[0]!.statement).toContain('From "trips", offense ran "pass" on 1 of 2');
    expect(f[0]!.excludedReason).toMatchObject({ s3: "unreviewed", s4: "unknown", s5: "rejected", s6: "rejected", s7: "unreviewed", s8: "other_unit" });
    expect(f[0]!.contraryEvidence).toHaveLength(1);
  });
  it("includes_inferred adds doubles → run 1 of 1 and trips → run 2 of 3", () => {
    const f = playTypeByFormation(segments, labels, { ...base, reviewBasis: "includes_inferred" });
    expect(f.map((x) => x.statement.replace(/ \(.*\)\.$/, ""))).toEqual([
      'From "doubles", offense ran "run" on 1 of 1 plays with a known play type',
      'From "trips", offense ran "pass" on 1 of 3 plays with a known play type',
      'From "trips", offense ran "run" on 2 of 3 plays with a known play type',
    ]);
  });
});

describe("tendencyBySituation", () => {
  it("reports only situation keys with known values; down 1 → pass 1 of 2, run 1 of 2 (reviewed_only)", () => {
    const f = tendencyBySituation(segments, labels, { ...base, reviewBasis: "reviewed_only" });
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.statement.replace(/ \(.*\)\.$/, ""))).toEqual([
      'With down = "1", offense ran "pass" on 1 of 2 plays with a known play type',
      'With down = "1", offense ran "run" on 1 of 2 plays with a known play type',
    ]);
    expect(f[0]!.includedSegmentIds).toEqual(["s1", "s2"]);
    expect(f[0]!.excludedReason.s5).toBe("rejected");
    expect(f[0]!.excludedReason.s4).toBe("unknown");
  });
  it("includes_inferred adds down 2 → run 1 of 1 from the unreviewed label", () => {
    const f = tendencyBySituation(segments, labels, { ...base, reviewBasis: "includes_inferred" });
    expect(f.map((x) => [x.numerator, x.denominator])).toEqual([[1, 2], [1, 2], [1, 1]]);
  });
  it("computeFindings concatenates all three kinds", () => {
    const all = computeFindings(segments, labels, { ...base, reviewBasis: "reviewed_only" });
    expect(all.map((f) => f.kind)).toEqual(["formation_frequency", "play_type_by_formation", "play_type_by_formation", "tendency_by_situation", "tendency_by_situation"]);
  });
});
