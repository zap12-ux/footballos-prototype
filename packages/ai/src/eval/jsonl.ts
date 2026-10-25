import { readFileSync } from "node:fs";
import { z } from "zod";

/** One coach label: the ground truth for a segment/key. `value` null means "coach says unknown". */
export const TruthRecord = z.object({
  segmentId: z.string().min(1),
  gameId: z.string().min(1),
  key: z.string().min(1),
  value: z.string().nullable(),
});
export type TruthRecord = z.infer<typeof TruthRecord>;

/** One prediction: same shape plus `abstained`. */
export const PredictionRecord = TruthRecord.extend({
  abstained: z.boolean(),
});
export type PredictionRecord = z.infer<typeof PredictionRecord>;

export function parseJsonl<T>(text: string, schema: z.ZodType<T>, source = "<input>"): T[] {
  const out: T[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`${source}:${i + 1}: not valid JSON`);
    }
    const parsed = schema.safeParse(obj);
    if (!parsed.success) throw new Error(`${source}:${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    out.push(parsed.data);
  });
  return out;
}

export function readTruthJsonl(path: string): TruthRecord[] {
  return parseJsonl(readFileSync(path, "utf8"), TruthRecord, path);
}

export function readPredictionsJsonl(path: string): PredictionRecord[] {
  return parseJsonl(readFileSync(path, "utf8"), PredictionRecord, path);
}
