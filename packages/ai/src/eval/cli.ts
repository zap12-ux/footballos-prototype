import { writeFileSync } from "node:fs";
import { readPredictionFile, readTruthFile } from "./jsonl.js";
import { evaluate } from "./metrics.js";
import { splitByGame, splitExplicit } from "./split.js";
import type { EvalReport } from "./types.js";

export interface CliArgs {
  truth: string;
  pred: string;
  heldOutGames: string[] | null;
  heldOutFraction: number;
  seed: string;
  json: string | null;
}

export const USAGE = `usage: footballos-ai-eval --truth coach.jsonl --pred predictions.jsonl
       [--held-out-games g1,g2 | --held-out-fraction 0.3 --seed footballos] [--json report.json]

Truth rows:      {"segmentId","gameId","key","value"}            (value null = coach unknown, not scored)
Prediction rows: {"segmentId","gameId","key","value","abstained"}
Metrics are computed on held-out games only; a segment in both a held-out and a training game fails the leakage check.`;

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { truth: "", pred: "", heldOutGames: null, heldOutFraction: 0.3, seed: "footballos", json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--truth": args.truth = next(); break;
      case "--pred": args.pred = next(); break;
      case "--held-out-games": args.heldOutGames = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--held-out-fraction": args.heldOutFraction = Number(next()); break;
      case "--seed": args.seed = next(); break;
      case "--json": args.json = next(); break;
      case "--help":
      case "-h":
        throw new Error(USAGE);
      default:
        throw new Error(`unknown argument ${a}\n${USAGE}`);
    }
  }
  if (!args.truth || !args.pred) throw new Error(`--truth and --pred are required\n${USAGE}`);
  return args;
}

export function runEval(args: CliArgs): EvalReport {
  const truth = readTruthFile(args.truth);
  const pred = readPredictionFile(args.pred);
  const games = [...truth, ...pred].map((r) => r.gameId);
  const split = args.heldOutGames ? splitExplicit(games, args.heldOutGames) : splitByGame(games, { heldOutFraction: args.heldOutFraction, seed: args.seed });
  const report = evaluate(truth, pred, split.heldOutGameIds, split.trainingGameIds);
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2) + "\n");
  return report;
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Held-out games: ${report.evaluatedGameIds.join(", ") || "(none)"}`);
  lines.push(`Training games: ${report.trainingGameIds.join(", ") || "(none)"}`);
  lines.push(`Segments evaluated: ${report.segmentsEvaluated}`);
  lines.push(`Leakage check: ${report.leakageCheck.ok ? "ok" : "FAILED (" + report.leakageCheck.offendingSegmentIds.join(", ") + ")"}`);
  lines.push("");
  lines.push("key                       n  pred  abst  miss  correct  acc(pred)  abstention  usable  error");
  for (const m of report.perKey) {
    lines.push(
      `${m.key.padEnd(22)} ${String(m.n).padStart(4)} ${String(m.predicted).padStart(5)} ${String(m.abstained).padStart(5)} ${String(m.missing).padStart(5)} ${String(m.correct).padStart(8)}  ${pct(m.accuracyOnPredicted).padStart(9)}  ${pct(m.abstentionRate).padStart(10)}  ${pct(m.usableCoverage).padStart(6)}  ${pct(m.errorRate).padStart(5)}`,
    );
  }
  lines.push("");
  for (const m of report.perKey) {
    lines.push(`confusion[${m.key}] (truth -> prediction: count)`);
    for (const [t, row] of Object.entries(m.confusion).sort()) {
      lines.push(`  ${t}: ${Object.entries(row).sort().map(([p, c]) => `${p}=${c}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function main(argv: string[]): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  try {
    const report = runEval(args);
    console.log(formatReport(report));
    return report.leakageCheck.ok ? 0 : 1;
  } catch (err) {
    console.error(`eval failed: ${(err as Error).message}`);
    return 1;
  }
}
