/**
 * The Hudl-derived fixtures (test/fixtures/hudl, see its README): five real games of
 * coach-tagged plays, anonymized, plus the transcribed calls of a real defensive playbook.
 * Expected numbers below were hand-computed from the raw export independently of the
 * converter; the fixture files are never read to derive an expectation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RecommendationSchema, ScoutingFindingSchema, type Concept, type ConceptKind } from "@footballos/contracts";
import {
  buildRecommendations,
  buildScoutingReport,
  computeFindings,
  evaluate,
  formationFrequency,
  guessKind,
  parsePredictionRows,
  parseTruthRows,
  playTypeByFormation,
  proposeFromPages,
  splitExplicit,
  tendencyBySituation,
  type Label,
  type PlaySegment,
  type ProposalPage,
  type ReportAsset,
  type StatSegment,
  type TruthRow,
} from "../src/index.js";
import { runEval } from "../src/eval/cli.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/hudl/${name}`, import.meta.url));

interface Bundle {
  teamId: string;
  opponents: { id: string; name: string }[];
  games: { id: string; opponentId: string; date: string; week: number }[];
  assets: { id: string; gameId: string; side: "our_offense" | "opponent_offense" | "special_teams"; analyzedTeam: "us" | "opponent"; analyzedUnit: "offense" | "special_teams" }[];
  segments: { id: string; gameId: string; assetId: string; side: string; index: number; startSec: number; endSec: number }[];
}
interface PlaybookConcepts {
  fronts: { name: string; kind: ConceptKind; page: number }[];
  calls: { name: string; front: string; versus: string | null; kind: ConceptKind; page: number }[];
}

const bundle = JSON.parse(readFileSync(fixture("bundle.json"), "utf8")) as Bundle;
const truth = parseTruthRows(readFileSync(fixture("coach.jsonl"), "utf8"));
const predictions = parsePredictionRows(readFileSync(fixture("predictions.jsonl"), "utf8"));
const playbook = JSON.parse(readFileSync(fixture("playbook-concepts.json"), "utf8")) as PlaybookConcepts;
const pages = JSON.parse(readFileSync(fixture("playbook-pages.json"), "utf8")) as ProposalPage[];

const TS = "2026-11-01T00:00:00.000Z";
const NOW = () => new Date("2026-11-21T12:00:00.000Z");
const opponent = (name: string) => bundle.opponents.find((o) => o.name === name)!.id;
const OPP_A = opponent("Opponent A");
const OPP_B = opponent("Opponent B");
const gamesOf = (opponentId: string) => bundle.games.filter((g) => g.opponentId === opponentId).map((g) => g.id);
const WEEK_5 = bundle.games.find((g) => g.week === 5)!.id;

/** Coach-accepted labels from truth rows: a known value is `accepted`, a null is `unknown`. */
function labelsFromTruth(rows: TruthRow[]): Label[] {
  return rows.map((r, i) => ({
    id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000001`,
    teamId: bundle.teamId,
    segmentId: r.segmentId,
    key: r.key as Label["key"],
    inferred: null,
    accepted: { value: r.value, status: r.value === null ? "unknown" : "accepted", byUserId: null, at: TS },
    provenanceId: null,
    version: 1,
    createdAt: TS,
    updatedAt: TS,
  }));
}
const labels = labelsFromTruth(truth);

function opponentOffenseSegments(opponentId: string): StatSegment[] {
  const games = new Set(gamesOf(opponentId));
  const assets = new Set(bundle.assets.filter((a) => a.side === "opponent_offense" && games.has(a.gameId)).map((a) => a.id));
  return bundle.segments.filter((s) => assets.has(s.assetId)).map((s) => ({ id: s.id, gameId: s.gameId, unit: "offense", reviewStatus: "accepted", supersededBy: [] }));
}

const byKind = (findings: { kind: string; statement: string }[], kind: string) => findings.filter((f) => f.kind === kind);
const statementOf = <T extends { statement: string; numerator: number; denominator: number }>(findings: T[], re: RegExp): T => {
  const f = findings.find((x) => re.test(x.statement));
  expect(f, `no finding matches ${re}`).toBeDefined();
  return f!;
};

describe("Hudl fixtures: shape", () => {
  it("has five games, three opponents, 477 plays and no identifying strings", () => {
    expect(bundle.games.map((g) => g.week)).toEqual([1, 2, 3, 4, 5]);
    expect(bundle.opponents.map((o) => o.name)).toEqual(["Opponent A", "Opponent B", "Opponent C"]);
    expect(gamesOf(OPP_B)).toHaveLength(3);
    expect(bundle.segments).toHaveLength(477);
    expect(bundle.assets).toHaveLength(15);
    const raw = readFileSync(fixture("bundle.json"), "utf8") + readFileSync(fixture("coach.jsonl"), "utf8");
    expect(raw).not.toMatch(/harvest|lions|bucks|christian|northside|maryland/i);
    expect(raw).not.toMatch(/jersey|rusher|passer|receiver/i);
  });

  it("labels every play with the harness keys and leaves what Hudl did not tag as null", () => {
    const keys = new Set(truth.map((r) => r.key));
    expect([...keys].sort()).toEqual(["formation_family", "hash", "motion", "play_type", "situation_distance", "situation_down", "situation_field_position", "special_teams_type", "unit"]);
    const perSegment = new Map<string, number>();
    for (const r of truth) perSegment.set(r.segmentId, (perSegment.get(r.segmentId) ?? 0) + 1);
    expect(perSegment.size).toBe(477);
    // Opponent B's offense was never tagged for formation in the export: all 131 plays carry an explicit null.
    const bSegs = new Set(opponentOffenseSegments(OPP_B).map((s) => s.id));
    expect(bSegs.size).toBe(131);
    expect(truth.filter((r) => bSegs.has(r.segmentId) && r.key === "formation_family").every((r) => r.value === null)).toBe(true);
    const values = (key: string) => new Set(truth.filter((r) => r.key === key && r.value !== null).map((r) => r.value));
    expect(values("play_type")).toEqual(new Set(["run", "pass", "other"]));
    expect(values("hash")).toEqual(new Set(["left", "middle", "right"]));
    expect(values("special_teams_type")).toEqual(new Set(["kickoff", "punt", "fg_pat", "return"]));
    expect(values("unit")).toEqual(new Set(["offense", "special_teams"]));
  });
});

describe("Hudl fixtures: evaluation harness at game scale", () => {
  it("holds out week 5 (Opponent B's third game) with no leakage and hand-checked key counts", () => {
    const split = splitExplicit(bundle.games.map((g) => g.id), [WEEK_5]);
    expect(split.trainingGameIds).toHaveLength(4);
    const r = evaluate(truth, predictions, split.heldOutGameIds, split.trainingGameIds);
    expect(r.leakageCheck.ok).toBe(true);
    expect(r.segmentsEvaluated).toBe(109); // 46 our offense + 43 opponent offense + 20 special teams
    const key = (k: string) => r.perKey.find((x) => x.key === k)!;
    expect(key("play_type").n).toBe(106); // 109 plays minus 3 untagged run/pass
    expect(key("situation_down").n).toBe(96); // kicks mostly carry no down
    expect(key("hash").n).toBe(109);
    expect(key("formation_family")).toBeUndefined(); // never tagged in this game: no row to score, so no metrics
    // Evidence-only keys: the synthetic model abstains or is right, never wrong (CONTRACTS §6).
    for (const k of ["situation_down", "situation_distance", "situation_field_position"]) {
      expect(key(k).errorRate, k).toBe(0);
      expect(key(k).abstentionRate, k).toBeGreaterThan(0.5);
    }
    // The degradation is seeded: the same files always score the same.
    const play = key("play_type");
    expect(play.predicted + play.abstained + play.missing).toBe(play.n);
    expect(play.accuracyOnPredicted).toBeGreaterThan(0.8);
    expect(play.accuracyOnPredicted).toBeLessThan(1);
    expect(Object.keys(play.confusion).sort()).toEqual(["other", "pass", "run"]);
  });

  it("runs through the CLI on the fixture files", () => {
    const report = runEval({ truth: fixture("coach.jsonl"), pred: fixture("predictions.jsonl"), heldOutGames: [WEEK_5], heldOutFraction: 0.3, seed: "footballos", json: null });
    expect(report.evaluatedGameIds).toEqual([WEEK_5]);
    expect(report.leakageCheck.ok).toBe(true);
    expect(report.perKey.find((k) => k.key === "play_type")!.n).toBe(106);
  });
});

describe("Hudl fixtures: scouting statistics on a real opponent", () => {
  const base = { teamId: bundle.teamId, opponentId: OPP_B, unit: "offense" as const, reviewBasis: "reviewed_only" as const, now: NOW };

  it("Opponent B by down over three games: 1st down run 33/50, 2nd down pass 22/36, 4th down pass 9/11", () => {
    const f = tendencyBySituation(opponentOffenseSegments(OPP_B), labels, base, ["situation_down"]);
    expect(f.every((x) => ScoutingFindingSchema.safeParse(x).success)).toBe(true);
    expect(f).toHaveLength(8); // four downs × run and pass
    expect(statementOf(f, /down = "1", offense ran "run"/)).toMatchObject({ numerator: 33, denominator: 50, percent: 66 });
    expect(statementOf(f, /down = "2", offense ran "pass"/)).toMatchObject({ numerator: 22, denominator: 36, percent: 61.1 });
    expect(statementOf(f, /down = "3", offense ran "pass"/)).toMatchObject({ numerator: 13, denominator: 27, percent: 48.1 });
    expect(statementOf(f, /down = "3", offense ran "run"/)).toMatchObject({ numerator: 14, denominator: 27 });
    expect(statementOf(f, /down = "4", offense ran "pass"/)).toMatchObject({ numerator: 9, denominator: 11, percent: 81.8 });
    const first = statementOf(f, /down = "1", offense ran "run"/);
    expect(first.gameIds.sort()).toEqual(gamesOf(OPP_B).sort());
    // The denominator is the 50 first-down plays; the 7 plays with no run/pass tag are listed as excluded, never counted.
    expect(first.includedSegmentIds).toHaveLength(50);
    expect(Object.keys(first.excludedReason)).toHaveLength(7);
    expect(Object.values(first.excludedReason).every((r) => r === "unknown")).toBe(true);
  });

  it("Opponent B by hash: no tendency clears 60% (left run 25/46, middle run 24/46, right pass 18/32)", () => {
    const f = tendencyBySituation(opponentOffenseSegments(OPP_B), labels, base, ["hash"]);
    expect(statementOf(f, /hash = "left", offense ran "run"/)).toMatchObject({ numerator: 25, denominator: 46 });
    expect(statementOf(f, /hash = "middle", offense ran "run"/)).toMatchObject({ numerator: 24, denominator: 46 });
    expect(statementOf(f, /hash = "right", offense ran "pass"/)).toMatchObject({ numerator: 18, denominator: 32 });
    expect(f.every((x) => (x.percent ?? 0) < 60)).toBe(true);
  });

  it("Opponent B has no formation findings because nothing was tagged, rather than a fabricated one", () => {
    expect(formationFrequency(opponentOffenseSegments(OPP_B), labels, base)).toEqual([]);
    expect(playTypeByFormation(opponentOffenseSegments(OPP_B), labels, base)).toEqual([]);
  });

  it("Opponent A (one game, formations tagged): pro / open 15 of 32 and always a run", () => {
    const segs = opponentOffenseSegments(OPP_A);
    expect(segs).toHaveLength(34);
    const opts = { ...base, opponentId: OPP_A };
    const freq = formationFrequency(segs, labels, opts);
    expect(statementOf(freq, /"pro \/ open"/)).toMatchObject({ numerator: 15, denominator: 32, percent: 46.9 });
    expect(statementOf(freq, /"pro \/ twins"/)).toMatchObject({ numerator: 10, denominator: 32 });
    expect(freq).toHaveLength(7);
    const byForm = playTypeByFormation(segs, labels, opts);
    expect(statementOf(byForm, /From "pro \/ open", offense ran "run"/)).toMatchObject({ numerator: 15, denominator: 15, percent: 100 });
    expect(statementOf(byForm, /From "pro \/ twins", offense ran "run"/)).toMatchObject({ numerator: 6, denominator: 10 });
    expect(statementOf(byForm, /From "pro \/ twins", offense ran "pass"/)).toMatchObject({ numerator: 4, denominator: 10 });
    expect(byKind(computeFindings(segs, labels, opts), "formation_frequency")).toHaveLength(7);
  });
});

// Report and recommendations ----------------------------------------------------------------

function reportAssets(): ReportAsset[] {
  return bundle.assets.map((a) => ({ id: a.id, gameId: a.gameId, status: "ready", context: { analyzedTeam: a.analyzedTeam, analyzedUnit: a.analyzedUnit, perspective: "sideline_fixed", teamCues: null } }));
}
function playSegments(): PlaySegment[] {
  return bundle.segments.map((s) => ({ id: s.id, teamId: bundle.teamId, assetId: s.assetId, gameId: s.gameId, index: s.index, startSec: s.startSec, endSec: s.endSec, origin: "proposed", reviewStatus: "accepted", supersededBy: [], version: 1, createdAt: TS, updatedAt: TS }));
}
const VERSION = "00000000-0000-4000-8000-00000000aaaa";
function conceptsFromPlaybook(): Concept[] {
  const all = [...playbook.fronts.map((f) => ({ name: f.name, kind: f.kind, page: f.page })), ...playbook.calls.map((c) => ({ name: c.name, kind: c.kind, page: c.page }))];
  return all.map((c, i) => ({
    id: `${String(i + 1).padStart(8, "0")}-0000-4000-8000-0000000000cc`,
    teamId: bundle.teamId,
    versionId: VERSION,
    name: c.name,
    kind: c.kind,
    description: "",
    installed: true,
    sources: [{ documentId: "00000000-0000-4000-8000-0000000000dd", pageNumber: c.page, bbox: null, excerpt: null }],
    status: "approved",
    basis: "model",
    note: "",
    decidedBy: null,
    decidedAt: null,
    version: 1,
    createdAt: TS,
    updatedAt: TS,
  }));
}

describe("Hudl fixtures: opponent report and defensive recommendations", () => {
  const report = buildScoutingReport({ teamId: bundle.teamId, opponentId: OPP_B, unit: "offense", reviewBasis: "reviewed_only", games: bundle.games.map((g) => ({ id: g.id, opponentId: g.opponentId })), assets: reportAssets(), segments: playSegments(), labels, now: NOW });

  it("draws on Opponent B's three opponent-offense assets only: 131 plays", () => {
    expect(report.sampleSize).toBe(131);
    expect(report.games.map((g) => g.gameId).sort()).toEqual(gamesOf(OPP_B).sort());
    const opponentAssets = new Set(bundle.assets.filter((a) => a.side === "opponent_offense").map((a) => a.id));
    for (const g of report.games) {
      expect(g.assetIds).toHaveLength(1);
      expect(opponentAssets.has(g.assetIds[0]!)).toBe(true);
    }
    expect(byKind(report.findings, "formation_frequency")).toHaveLength(0);
    expect(byKind(report.findings, "tendency_by_situation").length).toBeGreaterThan(8);
    expect(report.inputsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recommends against the down tendencies and grounds each item in the installed playbook", () => {
    let n = 0;
    const PLAYER = "00000000-0000-4000-8000-0000000000f1";
    const PACKAGE = "00000000-0000-4000-8000-0000000000f2";
    const SEASON = "00000000-0000-4000-8000-0000000000f3";
    const r = buildRecommendations({
      report: { teamId: bundle.teamId, opponentId: OPP_B, unit: "offense", reviewBasis: "reviewed_only", findings: report.findings, inputsHash: report.inputsHash },
      playbook: { versionId: VERSION, status: "approved", concepts: conceptsFromPlaybook() },
      personnel: {
        players: [{ id: PLAYER, teamId: bundle.teamId, seasonId: SEASON, jersey: "1", firstName: "Demo", lastName: "Player", positions: ["LB"], classYear: "JR", status: "active", strengths: [], developmentPriorities: [], notes: "", availability: [], version: 1, createdAt: TS, updatedAt: TS }],
        packages: [{ id: PACKAGE, teamId: bundle.teamId, seasonId: SEASON, unit: "defense", name: "Base", playerIds: [PLAYER], description: "", version: 1, createdAt: TS, updatedAt: TS }],
        depthChart: null,
        week: 5,
      },
      unit: "defense",
      gameId: WEEK_5,
      now: NOW,
      newId: () => `${String(++n).padStart(8, "0")}-0000-4000-8000-0000000000ee`,
    });
    expect(r.items.every((i) => RecommendationSchema.safeParse(i).success)).toBe(true);
    const statements = r.items.map((i) => i.statement);
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('With down "4", the opponent threw on 9 of 11 plays (81.8%)'),
      expect.stringContaining('With down "1", the opponent ran on 33 of 50 plays (66%)'),
      expect.stringContaining('With down "2", the opponent threw on 22 of 36 plays (61.1%)'),
    ]));
    expect(statements.some((s) => s.includes('down "3"'))).toBe(false); // 48/52 split: not a tendency
    expect(statements.some((s) => s.includes("hash"))).toBe(false);
    expect(statements.filter((s) => s.includes("With down")).length).toBe(3);
    // Distance and field position produce further situation items (e.g. a distance that was always a run);
    // every item is a situation tendency, with at least 4 plays and 60% or more, never a formation item.
    expect(r.types.every((t) => t === "defend_situation_pass" || t === "defend_situation_run")).toBe(true);
    for (const item of r.items) {
      expect(item.counts[0]!.of).toBeGreaterThanOrEqual(4);
      expect(item.counts[0]!.n / item.counts[0]!.of).toBeGreaterThanOrEqual(0.6);
    }
    expect(r.items.length).toBeGreaterThan(3);

    const concepts = conceptsFromPlaybook();
    const idsOf = (kind: ConceptKind) => concepts.filter((c) => c.kind === kind).map((c) => c.id);
    const pass = r.items.find((i) => i.statement.includes('down "4"'))!;
    const run = r.items.find((i) => i.statement.includes('down "1"'))!;
    // Pass tendency → coverage and pressure calls; run tendency → fronts and pressure calls; never the other way round.
    expect(pass.playbookConceptIds).toEqual(expect.arrayContaining(idsOf("coverage")));
    expect(pass.playbookConceptIds.some((id) => idsOf("front").includes(id))).toBe(false);
    expect(run.playbookConceptIds).toEqual(expect.arrayContaining(idsOf("front")));
    expect(run.playbookConceptIds.some((id) => idsOf("coverage").includes(id))).toBe(false);
    expect(pass.personnelPackageIds).toEqual([PACKAGE]);
    // The only note is the honest one: many distance / field-position cells have fewer than 4 plays.
    expect(r.blockedReasons.filter((b) => !b.startsWith("sample too small"))).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(70);
  });
});

describe("Hudl fixtures: a real playbook against the default vocabulary", () => {
  const names = [...playbook.fronts, ...playbook.calls].map((c) => c.name);

  it("default vocabulary resolves the generic names and misfiles the team's own", () => {
    expect(guessKind("3-4 (Odd)")).toBe("front");
    expect(guessKind("4-3 (Even)")).toBe("front");
    expect(guessKind("Dagger Tampa")).toBe("coverage");
    expect(guessKind("Curry (Sky)")).toBe("coverage");
    expect(guessKind("Salute (Cover 6)")).toBe("coverage");
    // Gaps a coach would hit: "heavy" is a formation word, "odd" a front word, call names mean nothing yet.
    expect(guessKind("60 (Heavy)")).toBe("formation");
    expect(guessKind("Odd Curry")).toBe("front");
    for (const name of ["Fiat Macho", "Bomb Tango", "Curry", "Tango Swing", "Base Curry (Bait)"]) expect(guessKind(name), name).toBe("other");
    const other = names.filter((n) => guessKind(n) === "other");
    expect(other.length).toBeGreaterThanOrEqual(12);
  });

  it("a team vocabulary of its call words makes every name land on the fixture's kind", () => {
    const vocabulary = {
      front: ["3-4 (odd)", "4-3 (even)", "60 (heavy)"],
      coverage: ["curry", "tango", "salute"],
      pressure: ["macho", "bomb tango", "grenade", "tnt curry", "bugatti curry", "dagger", "ferrari curry", "sword curry"],
    };
    for (const c of [...playbook.fronts, ...playbook.calls]) expect(guessKind(c.name, { custom: vocabulary }), c.name).toBe(c.kind);
  });

  it("the PDF text layer carries no play titles: text heuristics propose none of the calls", async () => {
    const r = await proposeFromPages(pages);
    expect(r.provenance).toEqual([]);
    expect(r.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);
    const lower = new Set(names.map((n) => n.toLowerCase()));
    for (const c of r.concepts) expect(lower.has(c.name.toLowerCase()), c.name).toBe(false);
    for (const c of r.concepts) expect(c.basis).toBe("text");
    // What it does find is the position letters of the diagrams ("BC FC", "J T N E"), read as all-caps
    // headings: dozens of junk proposals a coach would have to reject one by one. A Hudl export
    // needs the page-image path (a model) or a filter on such names before text heuristics help.
    expect(r.concepts.length).toBeGreaterThan(20);
    for (const c of r.concepts) expect(c.name, c.name).toMatch(/^[A-Z0-9 ]{1,15}$/);
    expect(r.concepts.every((c) => c.kind === "other")).toBe(true);
    expect(r.terms.map((t) => t.term)).toEqual(["Printed"]); // the print date line, read as "Term: definition"
  });
});
