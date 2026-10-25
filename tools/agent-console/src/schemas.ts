import { z } from 'zod';
import { RUNTIME_EVENT_TYPES } from './types.js';

const id = z.string().min(1).max(200);
const text = (max: number) => z.string().max(max);
const strList = z.array(z.string().max(2000)).max(500);

export const createRunSchema = z.object({
  kind: z.enum(['live', 'fixture']),
  label: text(200).min(1),
});

export const registerAgentSchema = z.object({
  runId: id,
  name: text(200).min(1),
  role: text(200).min(1),
  worktree: text(1000).nullish(),
  branch: text(300).nullish(),
  runtimeAgentId: text(300).nullish(),
});

export const patchAgentSchema = z
  .object({
    runtimeAgentId: text(300).nullish(),
    worktree: text(1000).nullish(),
    branch: text(300).nullish(),
    blockedByTaskId: id.nullish(),
  })
  .strict();

export const createTaskSchema = z.object({
  runId: id,
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/).optional(),
  title: text(300).min(1),
  objective: text(5000).min(1),
  acceptanceCriteria: strList.default([]),
  agentId: id.nullish(),
  dependsOn: strList.default([]),
  allowedPaths: strList.default([]),
  branch: text(300).nullish(),
});

export const taskStatusSchema = z.enum(['ready', 'in_progress', 'ready_for_review', 'integrated', 'verified', 'blocked']);

export const patchTaskSchema = z
  .object({
    status: taskStatusSchema.optional(),
    agentId: id.nullish(),
    dependsOn: strList.optional(),
    allowedPaths: strList.optional(),
    branch: text(300).nullish(),
    title: text(300).min(1).optional(),
    objective: text(5000).min(1).optional(),
    acceptanceCriteria: strList.optional(),
    verificationId: id.optional(),
  })
  .strict();

export const createVerificationSchema = z.object({
  taskId: id,
  kind: z.enum(['tests', 'integration_merge', 'browser', 'git', 'manual']),
  command: text(2000).nullish(),
  resultSummary: text(5000).min(1),
  passed: z.boolean(),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

export const runtimeEventSchema = z.object({
  type: z.enum(RUNTIME_EVENT_TYPES),
  runId: id.nullish(),
  agentId: id.nullish(),
  taskId: id.nullish(),
  responseId: id.nullish(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const submitResponseSchema = z.object({
  clientRequestId: id,
  questionVersion: z.number().int().min(1),
  text: text(10000).nullish(),
  option: text(500).nullish(),
});

export const selfStateSchema = z.enum(['working', 'reviewing', 'idle', 'waiting_on_dependency']);

export const reportStatusSchema = z.object({
  clientEventId: id,
  state: selfStateSchema,
  taskId: id.nullish(),
  message: text(5000).default(''),
});

export const askQuestionSchema = z.object({
  clientRequestId: id,
  taskId: id,
  question: text(5000).min(1),
  why: text(5000).default(''),
  options: z.array(z.string().min(1).max(500)).max(20).nullish(),
  recommendation: text(500).nullish(),
  blocking: z.boolean().default(false),
  supersedesQuestionId: id.nullish(),
});

export const ackSchema = z.object({
  responseId: id,
  note: text(2000).nullish(),
});

export const taskResultSchema = z.object({
  clientRequestId: id,
  status: z.enum(['completed', 'failed']),
  summary: text(10000).min(1),
  branch: text(300).min(1),
  commit: text(100).nullish(),
  changedFiles: strList.default([]),
  testsRun: z
    .array(z.object({ command: text(2000), passed: z.boolean(), summary: text(5000).default('') }))
    .max(200)
    .default([]),
  limitations: strList.default([]),
  followUps: strList.default([]),
});

export const logSchema = z.object({
  clientEventId: id,
  message: text(5000).min(1),
});
