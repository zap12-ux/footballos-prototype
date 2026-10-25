import { writeFileSync } from "node:fs";
import { readPredictionsJsonl, readTruthJsonl } from "./jsonl.js";
import { evaluateLabels, formatReport } from "./metrics.js";

const USAGE = `usage: footballos-ai-eval --truth coach.jsonl --pred predictions.jsonl
          [--held-out-games g1,g2 | --held-out-fraction 0.3] [--seed s] [--all-games] [--json out.json]

truth lines:      {"segmentId","gameId","key","value"}           value null = coach says unknown
prediction lines: {"segmentId","gameId","key","value","abstained"}
Scores held-out games only (split by gameId, never by clip).`;

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[name] = next;
      i++;
    } else out[name] = true;
  }
  return out;
}

export function runEvalCli(argv: string[], io: { log: (s: string) => void; error: (s: string) => void } = console): number {
  let args: Record<string, string | true>;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.error(String(err instanceof Error ? err.message : err));
    io.error(USAGE);
    return 2;
  }
  if (args.help || typeof args.truth !== "string" || typeof args.pred !== "string") {
    io.error(USAGE);
    return args.help ? 0 : 2;
  }
  try {
    const truth = readTruthJsonl(args.truth);
    const pred = readPredictionsJsonl(args.pred);
    const report = evaluateLabels(truth, pred, {
      heldOutGameIds: typeof args["held-out-games"] === "string" ? args["held-out-games"].split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      heldOutFraction: typeof args["held-out-fraction"] === "string" ? Number(args["held-out-fraction"]) : undefined,
      seed: typeof args.seed === "string" ? args.seed : undefined,
      scoreAllGames: args["all-games"] === true,
    });
    io.log(formatReport(report));
    if (typeof args.json === "string") writeFileSync(args.json, JSON.stringify(report, null, 2));
    return 0;
  } catch (err) {
    io.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
