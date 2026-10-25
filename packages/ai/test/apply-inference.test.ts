import { describe, expect, it } from "vitest";
import { applyInference, bulkAcceptPlan, type InferredLabel, type Label } from "../src/index.js";

const TEAM = "11111111-1111-4111-8111-111111111111";
const SEG = "22222222-2222-4222-8222-222222222222";
const OTHER_SEG = "33333333-3333-4333-8333-333333333333";
const PROV = (n: number) => `4444444${n}-4444-4444-8444-444444444444`;
const now = () => new Date("2026-10-25T12:00:00.000Z");
let counter = 0;
const newId = () => `5555555${counter++}-5555-4555-8555-555555555555`;

function inf(key: InferredLabel["key"], value: string | null, extra: Partial<InferredLabel["inferred"]> = {}): InferredLabel {
  return {
    key,
    inferred: {
      value,
      abstained: value === null,
      rationale: value === null ? "not visible" : `saw ${value}`,
      evidence: value === null ? [] : [{ assetId: "66666666-6666-4666-8666-666666666666", atSec: 10, toSec: null, frameIndex: 0, note: null }],
      uncertainty: value === null ? null : "low",
      ...extra,
    },
  };
}

function label(overrides: Partial<Label> & { key: Label["key"] }): Label {
  return {
    id: newId(),
    teamId: TEAM,
    segmentId: SEG,
    inferred: null,
    accepted: { value: null, status: "unknown", byUserId: null, at: null },
    provenanceId: null,
    version: 1,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyInference", () => {
  it("creates labels for new keys: inferred status with the value, unknown on abstention", () => {
    const { upserts } = applyInference([], SEG, [inf("formation_family", "trips"), inf("situation_down", null)], PROV(1), { teamId: TEAM, now, newId });
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toMatchObject({
      teamId: TEAM,
      segmentId: SEG,
      key: "formation_family",
      accepted: { value: "trips", status: "inferred", byUserId: null, at: null },
      provenanceId: PROV(1),
      version: 1,
      createdAt: "2026-10-25T12:00:00.000Z",
      updatedAt: "2026-10-25T12:00:00.000Z",
    });
    expect(upserts[0]!.inferred).toEqual(inf("formation_family", "trips").inferred);
    expect(upserts[1]).toMatchObject({ key: "situation_down", accepted: { value: null, status: "unknown" }, inferred: { abstained: true, value: null } });
    expect(new Set(upserts.map((u) => u.id)).size).toBe(2);
  });

  it("requires a teamId when the segment has no label yet", () => {
    expect(() => applyInference([], SEG, [inf("play_type", "run")], PROV(1))).toThrow(/no teamId/);
    // With a sibling label on the segment the teamId is taken from it.
    const sibling = label({ key: "unit", accepted: { value: "offense", status: "accepted", byUserId: null, at: null } });
    const { upserts } = applyInference([sibling], SEG, [inf("play_type", "run")], PROV(1), { now, newId });
    expect(upserts[0]!.teamId).toBe(TEAM);
  });

  it("a corrected label survives three reprocessings with different inferences; only inferred, provenance and version move", () => {
    const corrected = label({
      key: "formation_family",
      inferred: inf("formation_family", "trips").inferred,
      accepted: { value: "bunch", status: "corrected", byUserId: "77777777-7777-4777-8777-777777777777", at: "2026-10-24T10:00:00.000Z" },
      provenanceId: PROV(0),
      version: 2,
    });
    let rows: Label[] = [corrected];
    const seen = ["trips", null, "empty"] as const;
    seen.forEach((v, i) => {
      const { upserts } = applyInference(rows, SEG, [inf("formation_family", v)], PROV(i + 1), { now, newId });
      expect(upserts).toHaveLength(1);
      const u = upserts[0]!;
      expect(u.id).toBe(corrected.id);
      expect(u.accepted).toEqual(corrected.accepted);
      expect(u.inferred!.value).toBe(v);
      expect(u.provenanceId).toBe(PROV(i + 1));
      expect(u.version).toBe(3 + i);
      expect(u.createdAt).toBe(corrected.createdAt);
      rows = upserts;
    });
    expect(rows[0]!.accepted).toEqual({ value: "bunch", status: "corrected", byUserId: "77777777-7777-4777-8777-777777777777", at: "2026-10-24T10:00:00.000Z" });
  });

  it("never touches accepted or rejected labels either", () => {
    const accepted = label({ key: "play_type", inferred: inf("play_type", "run").inferred, accepted: { value: "run", status: "accepted", byUserId: "77777777-7777-4777-8777-777777777777", at: "2026-10-24T10:00:00.000Z" } });
    const rejected = label({ key: "motion", inferred: inf("motion", "jet").inferred, accepted: { value: null, status: "rejected", byUserId: "77777777-7777-4777-8777-777777777777", at: "2026-10-24T10:00:00.000Z" } });
    const { upserts } = applyInference([accepted, rejected], SEG, [inf("play_type", "pass"), inf("motion", null)], PROV(1), { now, newId });
    expect(upserts[0]!.accepted).toEqual(accepted.accepted);
    expect(upserts[0]!.inferred!.value).toBe("pass");
    expect(upserts[1]!.accepted).toEqual(rejected.accepted);
    expect(upserts[1]!.inferred!.abstained).toBe(true);
  });

  it("replaces a previously inferred value and turns an abstention into unknown (and back)", () => {
    const prior = label({ key: "play_type", inferred: inf("play_type", "run").inferred, accepted: { value: "run", status: "inferred", byUserId: null, at: null }, provenanceId: PROV(0) });
    const first = applyInference([prior], SEG, [inf("play_type", "pass")], PROV(1), { now, newId }).upserts[0]!;
    expect(first.accepted).toEqual({ value: "pass", status: "inferred", byUserId: null, at: null });
    expect(first.version).toBe(2);
    const second = applyInference([first], SEG, [inf("play_type", null)], PROV(2), { now, newId }).upserts[0]!;
    expect(second.accepted).toEqual({ value: null, status: "unknown", byUserId: null, at: null });
    expect(second.version).toBe(3);
    const third = applyInference([second], SEG, [inf("play_type", "run")], PROV(3), { now, newId }).upserts[0]!;
    expect(third.accepted).toEqual({ value: "run", status: "inferred", byUserId: null, at: null });
    expect(third.version).toBe(4);
  });

  it("ignores labels of other segments and keys not in the inference; uses the latest version when rows repeat", () => {
    const other = label({ key: "play_type", segmentId: OTHER_SEG, accepted: { value: "run", status: "inferred", byUserId: null, at: null } });
    const untouchedKey = label({ key: "hash", accepted: { value: "left", status: "accepted", byUserId: null, at: null } });
    const v1 = label({ key: "play_type", version: 1, accepted: { value: "run", status: "inferred", byUserId: null, at: null } });
    const v3 = { ...v1, version: 3 };
    const { upserts } = applyInference([other, untouchedKey, v1, v3], SEG, [inf("play_type", "pass")], PROV(1), { now, newId });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.id).toBe(v1.id);
    expect(upserts[0]!.version).toBe(4);
  });

  it("rejects malformed input", () => {
    expect(() => applyInference([], SEG, [inf("play_type", "run"), inf("play_type", "pass")], PROV(1), { teamId: TEAM })).toThrow(/duplicate/);
    expect(() => applyInference([], SEG, [inf("play_type", "run", { abstained: true })], PROV(1), { teamId: TEAM })).toThrow(/abstention/);
    expect(() => applyInference([], SEG, [], "")).toThrow(/provenanceId/);
  });
});

describe("bulkAcceptPlan", () => {
  const rows: Label[] = [
    label({ id: "a", key: "play_type", inferred: inf("play_type", "run").inferred, accepted: { value: "run", status: "inferred", byUserId: null, at: null } }),
    label({ id: "b", key: "formation_family", inferred: inf("formation_family", null).inferred, accepted: { value: null, status: "unknown", byUserId: null, at: null } }),
    label({ id: "c", key: "motion", inferred: inf("motion", null).inferred, accepted: { value: null, status: "inferred", byUserId: null, at: null } }),
    label({ id: "d", key: "hash", inferred: inf("hash", "left").inferred, accepted: { value: "right", status: "corrected", byUserId: null, at: null } }),
    label({ id: "e", key: "unit", inferred: inf("unit", "offense").inferred, accepted: { value: "offense", status: "accepted", byUserId: null, at: null } }),
    label({ id: "f", key: "alignment", inferred: null, accepted: { value: "x", status: "inferred", byUserId: null, at: null } }),
    label({ id: "g", key: "play_type", segmentId: OTHER_SEG, inferred: inf("play_type", "pass").inferred, accepted: { value: "pass", status: "inferred", byUserId: null, at: null } }),
    label({ id: "h", key: "personnel_estimate", inferred: inf("personnel_estimate", "11").inferred, accepted: { value: "11", status: "rejected", byUserId: null, at: null } }),
  ];

  it("accepts only inferred, non-abstained labels in scope and explains every skip", () => {
    const plan = bulkAcceptPlan(rows, { segmentIds: [SEG], keys: ["play_type", "formation_family", "motion", "hash", "unit", "alignment", "personnel_estimate"] });
    expect(plan.toAccept).toEqual(["a"]);
    expect(plan.skipped).toEqual([
      { id: "b", reason: "status_unknown" },
      { id: "c", reason: "abstained" },
      { id: "d", reason: "status_corrected" },
      { id: "e", reason: "status_accepted" },
      { id: "f", reason: "no_inference" },
      { id: "h", reason: "status_rejected" },
    ]);
  });

  it("scopes by segment and key; an empty selection list matches nothing; no filter means everything", () => {
    expect(bulkAcceptPlan(rows, { segmentIds: [SEG, OTHER_SEG], keys: ["play_type"] }).toAccept).toEqual(["a", "g"]);
    expect(bulkAcceptPlan(rows, { segmentIds: [], keys: ["play_type"] })).toEqual({ toAccept: [], skipped: [] });
    expect(bulkAcceptPlan(rows, {}).toAccept).toEqual(["a", "g"]);
    expect(bulkAcceptPlan([...rows, rows[0]!], { keys: ["play_type"] }).toAccept).toEqual(["a", "g"]);
  });
});
