import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Usage } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { modelProvenance, processingJobs } from '../db/schema.js';

export function monthBounds(at: Date): { month: string; fromIso: string; toIso: string } {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { month: from.toISOString().slice(0, 7), fromIso: from.toISOString(), toIso: to.toISOString() };
}

export function computeUsage(ctx: AppContext, teamId: string): Usage {
  const now = ctx.now();
  const { month, fromIso, toIso } = monthBounds(now);
  const prov = ctx.db
    .select({
      inputTokens: sql<number>`COALESCE(SUM(${modelProvenance.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${modelProvenance.outputTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${modelProvenance.costUsd}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(modelProvenance)
    .where(and(eq(modelProvenance.teamId, teamId), gte(modelProvenance.completedAt, fromIso), lt(modelProvenance.completedAt, toIso)))
    .get()!;
  const jobs = ctx.db
    .select({ status: processingJobs.status, n: sql<number>`COUNT(*)` })
    .from(processingJobs)
    .where(and(eq(processingJobs.teamId, teamId), gte(processingJobs.finishedAt, fromIso), lt(processingJobs.finishedAt, toIso)))
    .groupBy(processingJobs.status)
    .all();
  const count = (s: string) => Number(jobs.find((j) => j.status === s)?.n ?? 0);
  const costUsd = round6(Number(prov.costUsd));
  return {
    teamId, month,
    inputTokens: Number(prov.inputTokens), outputTokens: Number(prov.outputTokens), costUsd,
    // Local Ollama inference has no per-call charge, so there is no spend cap to report.
    monthlyCostCapUsd: null,
    jobsSucceeded: count('succeeded'), jobsFailed: count('failed'),
    byKind: Number(prov.count) > 0 ? [{ kind: 'infer_labels', inputTokens: Number(prov.inputTokens), outputTokens: Number(prov.outputTokens), costUsd }] : [],
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
