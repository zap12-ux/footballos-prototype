/**
 * MCP stdio server exposing the five agent operations (CONTRACT.md §4.2) as tools. Each tool
 * is a thin call to the HTTP API using CONSOLE_URL, CONSOLE_AGENT_ID and CONSOLE_AGENT_TOKEN.
 *
 * Status: unit-tested over stdio with the SDK client; NOT yet exercised inside a live Claude
 * Code session (registering it in .mcp.json takes effect only for a newly started session).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export interface McpEnv {
  consoleUrl: string;
  agentId: string;
  agentToken: string;
  fetchImpl?: typeof fetch;
}

export function envFromProcess(env: NodeJS.ProcessEnv = process.env): McpEnv {
  const agentId = env.CONSOLE_AGENT_ID;
  const agentToken = env.CONSOLE_AGENT_TOKEN;
  if (!agentId || !agentToken) throw new Error('CONSOLE_AGENT_ID and CONSOLE_AGENT_TOKEN must be set');
  return { consoleUrl: (env.CONSOLE_URL ?? 'http://127.0.0.1:4800').replace(/\/+$/, ''), agentId, agentToken };
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const bad = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: true });

export function createMcpServer(env: McpEnv): McpServer {
  const f = env.fetchImpl ?? fetch;
  const base = `${env.consoleUrl}/api/agent/${encodeURIComponent(env.agentId)}`;

  async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { authorization: `Bearer ${env.agentToken}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await f(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  const wrap = async (fn: () => Promise<{ status: number; body: unknown }>, okStatuses = [200, 201]): Promise<ToolResult> => {
    try {
      const res = await fn();
      if (okStatuses.includes(res.status)) return ok(res.body);
      return bad({ httpStatus: res.status, ...(typeof res.body === 'object' && res.body ? res.body : { body: res.body }) });
    } catch (err) {
      return bad({ error: { code: 'unreachable', message: `cannot reach console at ${env.consoleUrl}: ${err instanceof Error ? err.message : String(err)}` } });
    }
  };

  const server = new McpServer({ name: 'footballos-agent-console', version: '0.1.0' });

  server.registerTool(
    'report_status',
    {
      description: 'Report this agent\'s execution state (working|reviewing|idle|waiting_on_dependency) and a short message to the Agent Build Console.',
      inputSchema: {
        state: z.enum(['working', 'reviewing', 'idle', 'waiting_on_dependency']),
        taskId: z.string().optional(),
        message: z.string().default(''),
        clientEventId: z.string().optional().describe('Idempotency key; generated when omitted'),
      },
    },
    async (args) =>
      wrap(() =>
        call('POST', '/status', {
          clientEventId: args.clientEventId ?? randomUUID(),
          state: args.state,
          taskId: args.taskId ?? null,
          message: args.message,
        }),
      ),
  );

  server.registerTool(
    'ask_user',
    {
      description: 'Ask the owner a product question. Returns the question with its id; then call get_user_response to wait for the answer.',
      inputSchema: {
        taskId: z.string(),
        question: z.string(),
        why: z.string().default(''),
        options: z.array(z.string()).optional(),
        recommendation: z.string().optional(),
        blocking: z.boolean().default(false),
        supersedesQuestionId: z.string().optional(),
        clientRequestId: z.string().optional().describe('Idempotency key; generated when omitted'),
      },
    },
    async (args) =>
      wrap(() =>
        call('POST', '/questions', {
          clientRequestId: args.clientRequestId ?? randomUUID(),
          taskId: args.taskId,
          question: args.question,
          why: args.why,
          options: args.options ?? null,
          recommendation: args.recommendation ?? null,
          blocking: args.blocking,
          supersedesQuestionId: args.supersedesQuestionId ?? null,
        }),
      ),
  );

  server.registerTool(
    'get_user_response',
    {
      description: 'Long-poll (up to 30 s) for the owner\'s answer to a question. Returns {status:"answered", response, question}, {status:"pending"}, or {status:"gone"} when the question can no longer be answered.',
      inputSchema: {
        questionId: z.string(),
        waitSec: z.number().int().min(0).max(30).default(25),
      },
    },
    async (args) => {
      try {
        const res = await call('GET', `/questions/${encodeURIComponent(args.questionId)}/response?wait=${args.waitSec}`);
        if (res.status === 200) return ok({ status: 'answered', ...(res.body as object) });
        if (res.status === 204) return ok({ status: 'pending', questionId: args.questionId });
        if (res.status === 410) return ok({ status: 'gone', ...(res.body as object) });
        return bad({ httpStatus: res.status, ...(typeof res.body === 'object' && res.body ? res.body : { body: res.body }) });
      } catch (err) {
        return bad({ error: { code: 'unreachable', message: err instanceof Error ? err.message : String(err) } });
      }
    },
  );

  server.registerTool(
    'acknowledge_response',
    {
      description: 'Acknowledge that this agent received and will act on the owner\'s response. Idempotent.',
      inputSchema: {
        questionId: z.string(),
        responseId: z.string(),
        note: z.string().optional(),
      },
    },
    async (args) =>
      wrap(() => call('POST', `/questions/${encodeURIComponent(args.questionId)}/ack`, { responseId: args.responseId, note: args.note ?? null })),
  );

  server.registerTool(
    'report_task_result',
    {
      description: 'Report the outcome of a task. Sets the task to ready_for_review (never integrated/verified; those need a lead verification).',
      inputSchema: {
        taskId: z.string(),
        status: z.enum(['completed', 'failed']),
        summary: z.string(),
        branch: z.string(),
        commit: z.string().optional(),
        changedFiles: z.array(z.string()).default([]),
        testsRun: z.array(z.object({ command: z.string(), passed: z.boolean(), summary: z.string().default('') })).default([]),
        limitations: z.array(z.string()).default([]),
        followUps: z.array(z.string()).default([]),
        clientRequestId: z.string().optional().describe('Idempotency key; generated when omitted'),
      },
    },
    async (args) =>
      wrap(() =>
        call('POST', `/tasks/${encodeURIComponent(args.taskId)}/result`, {
          clientRequestId: args.clientRequestId ?? randomUUID(),
          status: args.status,
          summary: args.summary,
          branch: args.branch,
          commit: args.commit ?? null,
          changedFiles: args.changedFiles,
          testsRun: args.testsRun,
          limitations: args.limitations,
          followUps: args.followUps,
        }),
      ),
  );

  return server;
}

export async function main() {
  const server = createMcpServer(envFromProcess());
  await server.connect(new StdioServerTransport());
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[agent-console-mcp] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
