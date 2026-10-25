import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, intervalIoU, matchSegments, parsePredictionRows, parseTruthRows, splitByGame, splitExplicit } from "../src/index.js";
import { formatReport, parseArgs, runEval } from "../src/eval/cli.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const truth = parseTruthRows(readFileSync(fixture("coach.jsonl"), "utf8"));
const pred = parsePredictionRows(readFileSync(fixture("predictions.jsonl"), "utf8"));

describe("JSONL parsing", () => {
  it("parses the synthetic fixtures and rejects malformed rows", () => {
    expect(truth).toHaveLength(18);
    expect(pred).toHaveLength(17);
    expect(() => parseTruthRows('{"segmentId":"a","gameId":"g","key":"k","value":3}')).toThrow(/value/);
    expect(() => parsePredictionRows('{"segmentId":"a","gameId":"g","key":"k","value":"x","abstained":true}')).toThrow(/abstained/);
    expect(() => parsePredictionRows("{not json")).toThrow(/line 1/);
  });
});

describe("game split", () => {
  it("is deterministic for a seed and never splits a game", () => {
    const a = splitByGame(["demo_game_1", "demo_game_2", "demo_game_3"], { heldOutFraction: 0.34, seed: "s" });
    const b = splitByGame(["demo_game_3", "demo_game_1", "demo_game_2", "demo_game_1"], { heldOutFraction: 0.34, seed: "s" });
    expect(a).toEqual(b);
    expect(a.heldOutGameIds).toHaveLength(1);
    expect(a.trainingGameIds).toHaveLength(2);
    expect(new Set([...a.heldOutGameIds, ...a.trainingGameIds]).size).toBe(3);
    expect(splitExplicit(["g1", "g2"], ["g2"])).toEqual({ heldOutGameIds: ["g2"], trainingGameIds: ["g1"] });
  });
});

describe("evaluate", () => {
  it("computes hand-checked per-key metrics on held-out games 1 and 2 only", () => {
    const r = evaluate(truth, pred, ["demo_game_1", "demo_game_2"], ["demo_game_3"]);
    expect(r.leakageCheck.ok).toBe(true);
    expect(r.segmentsEvaluated).toBe(7);
    const form = r.perKey.find((k) => k.key === "formation_family")!;
    // labeled: g1 s1,s2,s3 (s4 null, skipped), g2 s1,s2,s3 → n=6
    // predicted: s1 trips✓, s2 trips✗, s3 trips✓, g2s1 Empty✓(case-insensitive), g2s3 trips✓ → predicted 5, correct 4; g2s2 abstained
    expect(form).toMatchObject({ n: 6, predicted: 5, abstained: 1, missing: 0, correct: 4, accuracyOnPredicted: 0.8, abstentionRate: 0.1667, usableCoverage: 0.6667, errorRate: 0.1667 });
    expect(form.confusion).toEqual({ trips: { trips: 3, "<abstain>": 1 }, doubles: { trips: 1 }, empty: { empty: 1 } });
    const play = r.perKey.find((k) => k.key === "play_type")!;
    // labeled: g1 s1..s4 and g2 s1..s3 → n=7; s2 abstained, g2s2 run→pass wrong, g2s3 missing → predicted 5 correct 4
    expect(play).toMatchObject({ n: 7, predicted: 5, abstained: 1, missing: 1, correct: 4, accuracyOnPredicted: 0.8, abstentionRate: 0.2857, usableCoverage: 0.5714 });
    expect(play.confusion.run).toEqual({ "<abstain>": 1, run: 1, pass: 1 });
    expect(play.confusion.pass).toEqual({ pass: 3, "<abstain>": 1 });
  });

  it("flags clip leakage when a segment id appears in both held-out and training games", () => {
    const leaked = [...truth, { segmentId: "demo_g1_s1", gameId: "demo_game_3", key: "play_type", value: "run" }];
    const r = evaluate(leaked, pred, ["demo_game_1"], ["demo_game_3"]);
    expect(r.leakageCheck).toEqual({ ok: false, offendingSegmentIds: ["demo_g1_s1"] });
  });

  it("CLI runs end to end on the fixtures and prints a report", () => {
    const args = parseArgs(["--truth", fixture("coach.jsonl"), "--pred", fixture("predictions.jsonl"), "--held-out-games", "demo_game_3"]);
    const report = runEval(args);
    expect(report.evaluatedGameIds).toEqual(["demo_game_3"]);
    expect(report.perKey.find((k) => k.key === "formation_family")).toMatchObject({ n: 2, correct: 1, accuracyOnPredicted: 0.5 });
    const text = formatReport(report);
    expect(text).toContain("Held-out games: demo_game_3");
    expect(text).toContain("Leakage check: ok");
    expect(() => parseArgs(["--pred", "x"])).toThrow(/--truth/);
  });
});

describe("segmentation utilities", () => {
  it("IoU and greedy matching with boundary errors", () => {
    expect(intervalIoU({ startSec: 0, endSec: 10 }, { startSec: 5, endSec: 15 })).toBeCloseTo(5 / 15);
    expect(intervalIoU({ startSec: 0, endSec: 1 }, { startSec: 2, endSec: 3 })).toBe(0);
    const truthSegs = [{ startSec: 0, endSec: 8 }, { startSec: 20, endSec: 27 }, { startSec: 40, endSec: 46 }];
    const predSegs = [{ startSec: 1, endSec: 8.5 }, { startSec: 19, endSec: 26 }, { startSec: 60, endSec: 66 }];
    const r = matchSegments(truthSegs, predSegs, 0.5);
    expect(r.matched).toBe(2);
    expect(r.precision).toBeCloseTo(2 / 3);
    expect(r.recall).toBeCloseTo(2 / 3);
    expect(r.unmatchedTruthIndices).toEqual([2]);
    expect(r.unmatchedPredictedIndices).toEqual([2]);
    expect(r.boundary.meanStartErrorSec).toBeCloseTo(1);
    expect(r.boundary.medianEndErrorSec).toBeCloseTo(0.75);
    expect(r.pairs[0]).toMatchObject({ truthIndex: 0, predictedIndex: 0 });
    expect(matchSegments([], []).precision).toBeNull();
  });
});
