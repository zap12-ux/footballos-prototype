import { describe, expect, it } from "vitest";
import { RecommendationSchema, type Concept, type GamePlanVersion, type PersonnelPackage } from "@footballos/contracts";
import {
  buildRecommendations,
  classifyFinding,
  computeFindings,
  evaluatePackages,
  findingFacets,
  planReviewFlags,
  recommendationInputHashes,
  recommendationInputsHash,
  type Label,
  type PersonnelPlayer,
  type RecommendationInputs,
  type ScoutingFinding,
  type StatSegment,
} from "../src/index.js";

const u = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const TEAM = u(1), OPP = u(2), GAME = u(3), G1 = u(11), G2 = u(12), ASSET = u(21), SEASON = u(30), VERSION = u(40), OLD_VERSION = u(41);
const NOW = () => new Date("2026-10-25T18:00:00.000Z");
const TS = "2026-10-25T17:00:00.000Z";
let idn = 0;
const newId = () => u(9000 + idn++);

const ev = (atSec: number) => ({ assetId: ASSET, atSec, toSec: null, frameIndex: 0, note: null });

function finding(id: number, kind: ScoutingFinding["kind"], statement: string, numerator: number, denominator: number, extra: Partial<ScoutingFinding> = {}): ScoutingFinding {
  return {
    id: u(100 + id), teamId: TEAM, opponentId: OPP, gameIds: [G1, G2], unit: "offense", kind, statement, numerator, denominator,
    percent: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10, sampleSize: denominator,
    includedSegmentIds: [], excludedSegmentIds: [u(900), u(901)], excludedReason: {}, reviewBasis: "reviewed_only",
    supportingEvidence: Array.from({ length: numerator }, (_, i) => ev(id * 100 + i)), contraryEvidence: [],
    computedAt: "2026-10-25T17:00:00.000Z", computeVersion: "stats-0.1.0", ...extra,
  };
}

const findings: ScoutingFinding[] = [
  finding(1, "formation_frequency", 'offense lined up in "trips" on 9 of 20 plays with a known formation (coach-reviewed labels only).', 9, 20),
  finding(2, "formation_frequency", 'offense lined up in "bunch" on 2 of 20 plays with a known formation (coach-reviewed labels only).', 2, 20),
  finding(3, "play_type_by_formation", 'From "I-form", offense ran "run" on 6 of 8 plays with a known play type (coach-reviewed labels only).', 6, 8),
  finding(4, "play_type_by_formation", 'From "I-form", offense ran "pass" on 2 of 8 plays with a known play type (coach-reviewed labels only).', 2, 8),
  finding(5, "tendency_by_situation", 'With down = "3", offense ran "pass" on 5 of 6 plays with a known play type (coach-reviewed labels only).', 5, 6, { gameIds: [G1] }),
  finding(6, "tendency_by_situation", 'With down = "3", offense ran "run" on 1 of 6 plays with a known play type (coach-reviewed labels only).', 1, 6, { gameIds: [G1] }),
  finding(7, "play_type_by_formation", 'From "empty", offense ran "pass" on 3 of 3 plays with a known play type (coach-reviewed labels only).', 3, 3),
];

function concept(id: number, kind: Concept["kind"], name: string, extra: Partial<Concept> = {}): Concept {
  return { id: u(200 + id), teamId: TEAM, versionId: VERSION, name, kind, description: "", installed: true, sources: [], status: "approved", basis: "text", note: "", decidedBy: null, decidedAt: null, version: 1, createdAt: TS, updatedAt: TS, ...extra };
}
const concepts: Concept[] = [
  concept(1, "front", "Over"),
  concept(2, "coverage", "Cover 3 Sky"),
  concept(3, "pressure", "Thunder"),
  concept(4, "front", "Bear", { installed: false }),
  concept(5, "coverage", "Cover 0", { status: "rejected" }),
  concept(6, "coverage", "Quarters", { versionId: OLD_VERSION }),
  concept(7, "run", "Inside Zone"),
  concept(8, "front", "Under", { status: "proposed" }),
];

function player(id: number, lastName: string, extra: Partial<PersonnelPlayer> = {}): PersonnelPlayer {
  return { id: u(300 + id), teamId: TEAM, seasonId: SEASON, jersey: String(id), firstName: "Demo", lastName, positions: ["LB"], classYear: "JR", status: "active", strengths: [], developmentPriorities: [], notes: "", availability: [], version: 1, createdAt: TS, updatedAt: TS, ...extra };
}
const players: PersonnelPlayer[] = [
  player(1, "Alpha"),
  player(2, "Bravo", { availability: [{ week: 5, status: "out", note: "ankle" }] }),
  player(3, "Charlie", { availability: [{ week: 5, status: "limited", note: "" }, { week: 4, status: "out", note: "" }] }),
  player(4, "Delta", { status: "inactive" }),
];
function pkg(id: number, name: string, playerIds: string[], unit: PersonnelPackage["unit"] = "defense"): PersonnelPackage {
  return { id: u(400 + id), teamId: TEAM, seasonId: SEASON, unit, name, playerIds, description: "", version: 1, createdAt: TS, updatedAt: TS };
}
const packages: PersonnelPackage[] = [
  pkg(1, "Base", [u(301)]),
  pkg(2, "Nickel", [u(301), u(302)]),
  pkg(3, "Dime", [u(301), u(303)]),
  pkg(4, "Inactive", [u(304)]),
  pkg(5, "Offense 11", [u(301)], "offense"),
];

function inputs(over: Partial<RecommendationInputs> = {}): RecommendationInputs {
  return {
    report: { teamId: TEAM, opponentId: OPP, unit: "offense", reviewBasis: "reviewed_only", findings, inputsHash: "abc" },
    playbook: { versionId: VERSION, status: "approved", concepts },
    personnel: { players, packages, depthChart: null, week: 5 },
    unit: "defense",
    gameId: GAME,
    ...over,
  };
}

describe("buildRecommendations — grounding", () => {
  it("produces grounded items for a defense plan from an opponent-offense report", () => {
    idn = 0;
    const r = buildRecommendations({ ...inputs(), now: NOW, newId });
    expect(r.items.map((i) => i.statement)).toEqual([
      expect.stringContaining('With down "3", the opponent threw on 5 of 6 plays (83.3%)'),
      expect.stringContaining('When the opponent lines up in "I-form", expect run: 6 of 8'),
      expect.stringContaining('Expect "trips" from the opponent offense: it was their formation on 9 of 20'),
    ]);
    expect(r.types).toEqual(["defend_situation_pass", "defend_run_tendency", "defend_formation"]);
    for (const item of r.items) {
      expect(RecommendationSchema.safeParse(item).success, JSON.stringify(RecommendationSchema.safeParse(item))).toBe(true);
      expect(item).toMatchObject({ teamId: TEAM, gameId: GAME, unit: "defense", status: "proposed", staleReason: null, decidedBy: null, decidedAt: null, inputsHash: r.inputsHash, version: 1, createdAt: "2026-10-25T18:00:00.000Z" });
      // Only Base (available) and Dime (limited player → available with caution); never Nickel (out), Inactive or the offense package.
      expect(item.personnelPackageIds).toEqual([u(401), u(403)]);
      expect(item.counts[0]!.n).toBeLessThanOrEqual(item.counts[0]!.of);
    }
    // Concept kinds follow the matching table; only installed, approved concepts of the approved version.
    const [situationPass, runTendency, formation] = r.items;
    expect(situationPass!.playbookConceptIds).toEqual([u(202), u(203)]); // coverage + pressure
    expect(runTendency!.playbookConceptIds).toEqual([u(201), u(203)]); // front + pressure
    expect(formation!.playbookConceptIds).toEqual([u(202), u(201)]); // coverage + front, by name
    for (const item of r.items) {
      expect(item.playbookConceptIds).not.toContain(u(204)); // not installed
      expect(item.playbookConceptIds).not.toContain(u(205)); // rejected
      expect(item.playbookConceptIds).not.toContain(u(206)); // other version
      expect(item.playbookConceptIds).not.toContain(u(207)); // run concept never grounds a defense item
      expect(item.playbookConceptIds).not.toContain(u(208)); // proposed
    }
  });

  it("carries supporting findings, evidence, counts with context, limitations and contrary evidence", () => {
    const r = buildRecommendations({ ...inputs(), now: NOW, newId });
    const run = r.items.find((i) => i.statement.includes("I-form"))!;
    expect(run.supportingFindings).toEqual([u(103)]);
    expect(run.supportingEvidence).toHaveLength(6);
    expect(run.supportingEvidence[0]).toEqual(ev(300));
    expect(run.counts).toEqual([{ n: 6, of: 8, context: 'run plays of all plays from "I-form" with a known play type, across 2 games' }]);
    expect(run.contraryEvidence).toEqual(findings[3]!.supportingEvidence);
    expect(run.limitations).toEqual([
      "Based on 8 plays across 2 games.",
      "Coach-reviewed labels only; 2 segment(s) were excluded (unreviewed, rejected, unknown or another unit).",
      "Down, distance and field position are not broken out; this is an overall tendency.",
      "2 of 8 plays in the same group went the other way (pass).",
      'Package "Dime": #3 Charlie is limited for week 5.',
    ]);
    const third = r.items.find((i) => i.statement.includes('down "3"'))!;
    expect(third.limitations).toContain("Based on 6 plays (small sample) across 1 game.");
    expect(third.limitations).toContain("All evidence comes from a single game; check whether it holds on other film before building around it.");
    expect(third.limitations).toContain("Only down is known for this split; distance, field position, score and clock were not combined.");
    expect(third.contraryEvidence).toEqual(findings[5]!.supportingEvidence);
    expect(third.supportingEvidence.length).toBeLessThanOrEqual(10);
  });

  it("skips small samples, non-tendencies and the losing side of a split, and explains each", () => {
    const r = buildRecommendations({ ...inputs(), now: NOW, newId });
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.findingId, s.reason]));
    expect(reasons[u(107)]).toMatch(/sample too small: 3 play\(s\), minimum 4/);
    expect(reasons[u(102)]).toMatch(/no tendency: 2 of 20 \(10%\) is below 25%/);
    expect(reasons[u(104)]).toMatch(/no tendency: 2 of 8 \(25%\) is below 60%/);
    expect(reasons[u(106)]).toMatch(/below 60%/);
    expect(r.blockedReasons).toEqual(["sample too small for 1 finding(s) (fewer than 4 plays)"]);
    // minSample is configurable; with 3 the "empty" finding grounds.
    const r3 = buildRecommendations({ ...inputs(), minSample: 3, now: NOW, newId });
    expect(r3.items.some((i) => i.statement.includes('"empty"'))).toBe(true);
    expect(r3.blockedReasons).toEqual([]);
  });

  it("is deterministic for the same inputs", () => {
    idn = 0;
    const a = buildRecommendations({ ...inputs(), now: NOW, newId });
    idn = 0;
    const b = buildRecommendations({ ...inputs(), now: NOW, newId });
    expect(a).toEqual(b);
    expect(a.inputsHash).toBe(recommendationInputsHash(inputs()));
  });

  it("returns [] with blockedReasons for the §15.3 preconditions", () => {
    expect(buildRecommendations({ ...inputs({ playbook: { versionId: null, concepts: [] } }), now: NOW })).toMatchObject({ items: [], blockedReasons: ["no approved playbook"] });
    expect(buildRecommendations({ ...inputs({ playbook: { versionId: VERSION, status: "draft", concepts } }), now: NOW }).blockedReasons).toEqual(["no approved playbook"]);
    expect(buildRecommendations({ ...inputs({ playbook: { versionId: VERSION, status: "approved", concepts: concepts.filter((c) => !c.installed) } }), now: NOW }).blockedReasons).toEqual(["no installed concepts in the approved playbook"]);
    expect(buildRecommendations({ ...inputs({ personnel: { players: [], packages: [], depthChart: null, week: 5 } }), now: NOW }).blockedReasons).toEqual(["no personnel"]);
    expect(buildRecommendations({ ...inputs({ report: { ...inputs().report, reviewBasis: "includes_inferred" } }), now: NOW }).blockedReasons[0]).toMatch(/includes_inferred.*coach-reviewed/);
    expect(buildRecommendations({ ...inputs({ unit: "offense" }), now: NOW }).blockedReasons[0]).toMatch(/offense plan needs the report on the opponent defense/);
    expect(buildRecommendations({ ...inputs({ report: { ...inputs().report, findings: [] } }), now: NOW }).blockedReasons).toEqual(["no scouting findings for this opponent and unit"]);
    expect(buildRecommendations({ ...inputs({ playbook: { versionId: null, concepts: [] }, personnel: { players: [], packages: [], depthChart: null, week: null } }), now: NOW }).blockedReasons).toEqual(["no approved playbook", "no personnel"]);
  });

  it("reports 'no installed concepts of kind …' when the playbook has only the wrong kinds", () => {
    const r = buildRecommendations({ ...inputs({ playbook: { versionId: VERSION, status: "approved", concepts: [concept(7, "run", "Inside Zone")] } }), now: NOW });
    expect(r.items).toEqual([]);
    expect(r.blockedReasons).toEqual([
      "sample too small for 1 finding(s) (fewer than 4 plays)",
      "no installed concepts of kind coverage/pressure (1 finding(s) could not be grounded)",
      "no installed concepts of kind front/coverage (1 finding(s) could not be grounded)",
      "no installed concepts of kind front/pressure (1 finding(s) could not be grounded)",
    ]);
  });

  it("still grounds on concepts when no package is available, and says so", () => {
    const r = buildRecommendations({ ...inputs({ personnel: { players, packages: [pkg(2, "Nickel", [u(302)])], depthChart: null, week: 5 } }), now: NOW });
    expect(r.items.length).toBe(3);
    for (const i of r.items) {
      expect(i.personnelPackageIds).toEqual([]);
      expect(i.limitations).toContain("No defense package is available for week 5; choose personnel by hand.");
    }
    expect(r.blockedReasons).toContain("no available defense packages for week 5");
    expect(r.packages).toEqual([{ packageId: u(402), name: "Nickel", available: false, reason: "#2 Bravo is out for week 5" }]);
  });

  it("evaluates package availability per §15.2", () => {
    const p = evaluatePackages({ players, packages, depthChart: null, week: 5 }, "defense");
    expect(p).toEqual([
      { packageId: u(401), name: "Base", available: true, reason: null },
      { packageId: u(402), name: "Nickel", available: false, reason: "#2 Bravo is out for week 5" },
      { packageId: u(403), name: "Dime", available: true, reason: "#3 Charlie is limited for week 5" },
      { packageId: u(404), name: "Inactive", available: false, reason: "#4 Delta is inactive" },
    ]);
    // Week 4: Charlie is out → Dime unavailable; Bravo has no entry → available.
    const w4 = evaluatePackages({ players, packages, depthChart: null, week: 4 }, "defense");
    expect(w4.find((x) => x.name === "Dime")).toMatchObject({ available: false, reason: "#3 Charlie is out for week 4" });
    expect(w4.find((x) => x.name === "Nickel")).toMatchObject({ available: true });
    // Unknown player → unavailable; unknown week → only roster status.
    expect(evaluatePackages({ players, packages: [pkg(9, "Ghost", [u(399)])], depthChart: null, week: 5 }, "defense")[0]).toMatchObject({ available: false, reason: `player ${u(399)} is not on the roster given` });
    expect(evaluatePackages({ players, packages, depthChart: null, week: null }, "defense").map((x) => x.available)).toEqual([true, true, true, false]);
    const r = buildRecommendations({ ...inputs({ personnel: { players, packages, depthChart: null, week: null } }), now: NOW });
    expect(r.items[0]!.limitations).toContain("The game week was not given, so weekly availability could not be applied; only roster status was checked.");
  });

  it("builds offense-plan items from an opponent-defense report with run/pass/protection concepts only", () => {
    const defenseReport = {
      teamId: TEAM, opponentId: OPP, unit: "defense" as const, reviewBasis: "reviewed_only" as const,
      findings: [
        finding(1, "formation_frequency", 'defense lined up in "4-3 over" on 12 of 20 plays with a known formation (coach-reviewed labels only).', 12, 20, { unit: "defense" }),
        finding(2, "play_type_by_formation", 'From "4-3 over", defense ran "run" on 6 of 8 plays with a known play type (coach-reviewed labels only).', 6, 8, { unit: "defense" }),
      ],
    };
    const offConcepts = [concept(1, "run", "Inside Zone"), concept(2, "pass", "Mesh"), concept(3, "protection", "Slide"), concept(4, "front", "Over")];
    const r = buildRecommendations({ report: defenseReport, playbook: { versionId: VERSION, status: "approved", concepts: offConcepts }, personnel: { players, packages, depthChart: null, week: 5 }, unit: "offense", gameId: GAME, now: NOW });
    expect(r.items).toHaveLength(1);
    expect(r.types).toEqual(["attack_defensive_look"]);
    expect(r.items[0]!.statement).toContain('Expect the opponent defense in "4-3 over"');
    expect(r.items[0]!.playbookConceptIds).toEqual([u(201), u(202), u(203)]);
    expect(r.items[0]!.personnelPackageIds).toEqual([u(405)]);
    expect(r.skipped[0]!.reason).toMatch(/play-type tendencies describe an offense/);
  });

  it("rejects malformed input", () => {
    expect(() => buildRecommendations({ ...inputs(), unit: "mixed" as never })).toThrow(/unit/);
    expect(() => buildRecommendations({ ...inputs(), gameId: "" })).toThrow(/gameId/);
    expect(() => buildRecommendations({ ...inputs(), report: {} as never })).toThrow(/findings/);
  });
});

describe("findingFacets stays in sync with the statements stats/findings.ts writes", () => {
  it("parses dimensions from real computed findings", () => {
    const seg = (id: string): StatSegment => ({ id, gameId: G1, unit: "offense", reviewStatus: "accepted", supersededBy: [] });
    let n = 0;
    const lab = (segmentId: string, key: Label["key"], value: string): Label => ({ id: u(700 + n++), teamId: TEAM, segmentId, key, inferred: { value, abstained: false, rationale: "", evidence: [ev(1)], uncertainty: "low" }, accepted: { value, status: "accepted", byUserId: null, at: null }, provenanceId: null, version: 1, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z" });
    const segs = [u(601), u(602), u(603), u(604)].map(seg);
    const labels = segs.flatMap((s, i) => [lab(s.id, "formation_family", "I form"), lab(s.id, "play_type", i < 3 ? "run" : "pass"), lab(s.id, "situation_down", "3")]);
    const fs = computeFindings(segs, labels, { teamId: TEAM, opponentId: OPP, unit: "offense", reviewBasis: "reviewed_only", now: NOW });
    const byKind = Object.fromEntries(fs.map((f) => [`${f.kind}:${f.statement.includes('"run"') ? "run" : f.statement.includes('"pass"') ? "pass" : ""}`, f]));
    expect(findingFacets(byKind["formation_frequency:"]!)).toEqual({ formation: "I form" });
    expect(findingFacets(byKind["play_type_by_formation:run"]!)).toEqual({ formation: "I form", playType: "run" });
    expect(findingFacets(byKind["tendency_by_situation:pass"]!)).toEqual({ situationKey: "situation_down", situationValue: "3", playType: "pass" });
    expect(classifyFinding(byKind["play_type_by_formation:run"]!, "defense")).toEqual({ ok: true, value: { type: "defend_run_tendency", facets: { formation: "I form", playType: "run" } } });
    expect(classifyFinding({ kind: "uncertain", statement: "x" }, "defense")).toMatchObject({ ok: false });
    expect(classifyFinding({ kind: "formation_frequency", statement: "hand-written" }, "defense")).toMatchObject({ ok: false, reason: expect.stringContaining("could not be read") });
  });
});

describe("recommendationInputsHash", () => {
  it("is stable under reordering and changes when any grounding input changes", () => {
    const base = inputs();
    const h = recommendationInputsHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const reordered = inputs({
      report: { ...base.report, findings: [...base.report.findings].reverse() },
      playbook: { ...base.playbook, concepts: [...concepts].reverse() },
      personnel: { players: [...players].reverse(), packages: [...packages].reverse(), depthChart: null, week: 5 },
    });
    expect(recommendationInputsHash(reordered)).toBe(h);

    const parts = recommendationInputHashes(base);
    expect(parts.inputsHash).toBe(h);

    // A finding's value changes → labels hash and inputs hash change; others do not.
    const f2 = recommendationInputHashes(inputs({ report: { ...base.report, findings: base.report.findings.map((f, i) => (i === 0 ? { ...f, numerator: 10 } : f)) } }));
    expect(f2.labelsHash).not.toBe(parts.labelsHash);
    expect(f2.playbookHash).toBe(parts.playbookHash);
    expect(f2.personnelHash).toBe(parts.personnelHash);
    expect(f2.inputsHash).not.toBe(h);

    // An installed concept's version changes → playbook hash changes; a non-installed one does not matter.
    const c2 = recommendationInputHashes(inputs({ playbook: { ...base.playbook, concepts: concepts.map((c) => (c.id === u(201) ? { ...c, version: 2 } : c)) } }));
    expect(c2.playbookHash).not.toBe(parts.playbookHash);
    const c3 = recommendationInputHashes(inputs({ playbook: { ...base.playbook, concepts: concepts.map((c) => (c.id === u(204) ? { ...c, version: 7 } : c)) } }));
    expect(c3.playbookHash).toBe(parts.playbookHash);
    expect(recommendationInputHashes(inputs({ playbook: { ...base.playbook, versionId: OLD_VERSION } })).playbookHash).not.toBe(parts.playbookHash);

    // Availability, week, package membership, depth chart.
    const a2 = recommendationInputHashes(inputs({ personnel: { ...base.personnel, players: players.map((p) => (p.id === u(301) ? { ...p, availability: [{ week: 5, status: "out", note: "" }] } : p)) } }));
    expect(a2.personnelHash).not.toBe(parts.personnelHash);
    expect(recommendationInputHashes(inputs({ personnel: { ...base.personnel, week: 6 } })).personnelHash).not.toBe(parts.personnelHash);
    expect(recommendationInputHashes(inputs({ personnel: { ...base.personnel, depthChart: { id: u(500), teamId: TEAM, seasonId: SEASON, unit: "defense", slots: [], version: 3, updatedAt: TS } } })).personnelHash).not.toBe(parts.personnelHash);

    // Different game or unit → different combined hash, same components.
    const g2 = recommendationInputHashes(inputs({ gameId: u(4) }));
    expect(g2.inputsHash).not.toBe(h);
    expect(g2.labelsHash).toBe(parts.labelsHash);
  });
});

describe("planReviewFlags", () => {
  const itemId = (n: number) => u(800 + n);
  function version(items: { id: string; rec: string | null }[], extra: Partial<GamePlanVersion> = {}): GamePlanVersion {
    return {
      id: u(850), planId: u(851), number: 2, status: "approved", basedOn: null,
      sections: [
        { key: "fronts", title: "Fronts", items: items.slice(0, 1).map((i, order) => ({ id: i.id, text: "x", sourceRecommendationId: i.rec, conceptIds: [], packageIds: [], order })) },
        { key: "coverages", title: "Coverages", items: items.slice(1).map((i, order) => ({ id: i.id, text: "y", sourceRecommendationId: i.rec, conceptIds: [], packageIds: [], order })) },
      ],
      createdBy: u(5), createdAt: "2026-10-20T12:00:00.000Z", approvedBy: u(5), approvedAt: "2026-10-21T12:00:00.000Z", override: false, version: 1, ...extra,
    };
  }
  const base = inputs();
  const hashes = recommendationInputHashes(base);
  const recs = buildRecommendations({ ...base, now: NOW, newId: (() => { let k = 0; return () => u(9100 + k++); })() }).items;
  const v = version([{ id: itemId(1), rec: recs[0]!.id }, { id: itemId(2), rec: recs[1]!.id }, { id: itemId(3), rec: null }]);

  it("returns no flags when the stored hashes still match", () => {
    expect(planReviewFlags({ version: v, recommendations: recs, currentHashes: hashes })).toEqual([]);
  });

  it("flags each item whose recommendation inputs changed, with the recommendation's createdAt as since", () => {
    const changed = recommendationInputHashes(inputs({ personnel: { ...base.personnel, week: 6 } }));
    const flags = planReviewFlags({ version: v, recommendations: recs, currentHashes: changed });
    expect(flags).toEqual([
      { kind: "stale_recommendation", message: expect.stringContaining("have changed since it was generated"), itemId: itemId(1), since: "2026-10-25T18:00:00.000Z" },
      { kind: "stale_recommendation", message: expect.stringContaining("have changed since it was generated"), itemId: itemId(2), since: "2026-10-25T18:00:00.000Z" },
    ]);
  });

  it("flags a recommendation already marked stale and an item whose recommendation is missing", () => {
    const stale = recs.map((r, i) => (i === 0 ? { ...r, status: "stale" as const, staleReason: "regenerated", decidedAt: "2026-10-24T09:00:00.000Z" } : r));
    const flags = planReviewFlags({ version: v, recommendations: stale.slice(0, 1), currentHashes: hashes });
    expect(flags).toEqual([
      { kind: "stale_recommendation", message: "The recommendation behind this item is stale (regenerated); review the item.", itemId: itemId(1), since: "2026-10-24T09:00:00.000Z" },
      { kind: "stale_recommendation", message: expect.stringContaining("no longer available"), itemId: itemId(2), since: "2026-10-20T12:00:00.000Z" },
    ]);
  });

  it("adds component flags from a baseline (or from hashes stored with the recommendations)", () => {
    const changed = recommendationInputHashes(inputs({ playbook: { ...base.playbook, concepts: concepts.map((c) => (c.id === u(201) ? { ...c, version: 2 } : c)) } }));
    const withBaseline = planReviewFlags({ version: v, recommendations: recs, currentHashes: changed, baselineHashes: { ...hashes, at: "2026-10-21T12:00:00.000Z" } });
    expect(withBaseline.map((f) => f.kind)).toEqual(["playbook_changed", "stale_recommendation", "stale_recommendation"]);
    expect(withBaseline[0]).toEqual({ kind: "playbook_changed", message: "The approved playbook or its installed concepts changed after this plan version was prepared; 2 item(s) came from recommendations that need review.", since: "2026-10-21T12:00:00.000Z" });

    const stored = recs.map((r) => ({ ...r, inputHashes: hashes }));
    const both = recommendationInputHashes(inputs({ personnel: { ...base.personnel, week: 6 }, report: { ...base.report, inputsHash: "def" } }));
    const fromRecs = planReviewFlags({ version: v, recommendations: stored, currentHashes: both });
    expect(fromRecs.map((f) => f.kind)).toEqual(["labels_changed", "personnel_changed", "stale_recommendation", "stale_recommendation"]);
    expect(fromRecs[0]!.since).toBe("2026-10-25T18:00:00.000Z");

    // Without any component hashes, only item flags.
    expect(planReviewFlags({ version: v, recommendations: recs, currentHashes: { inputsHash: both.inputsHash } }).map((f) => f.kind)).toEqual(["stale_recommendation", "stale_recommendation"]);
  });

  it("never flags a superseded version and validates its input", () => {
    expect(planReviewFlags({ version: { ...v, status: "superseded" }, recommendations: [], currentHashes: { inputsHash: "zzz" } })).toEqual([]);
    expect(() => planReviewFlags({ version: v, recommendations: [], currentHashes: {} as never })).toThrow(/inputsHash/);
  });
});
