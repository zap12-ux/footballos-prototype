import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageDir } from '../config.js';
import { ask, listen, makeHarness, seed, type Harness } from './helpers.js';

let h: Harness;
let srv: Awaited<ReturnType<typeof listen>>;
let s: Awaited<ReturnType<typeof seed>>;
let client: Client;
let transport: StdioClientTransport;

const text = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]!).text);

beforeAll(async () => {
  h = makeHarness();
  srv = await listen(h);
  s = await seed(h);
  // Drive the real stdio server as a child process (tsx loads the TS source directly).
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', path.join(packageDir, 'src', 'mcp-server.ts')],
    env: {
      ...(process.env as Record<string, string>),
      CONSOLE_URL: srv.url,
      CONSOLE_AGENT_ID: s.a1.id,
      CONSOLE_AGENT_TOKEN: s.tok1,
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close().catch(() => undefined);
  await srv?.close();
  h?.close();
});

describe('MCP stdio server', () => {
  it('lists the five tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(
      ['acknowledge_response', 'ask_user', 'get_user_response', 'report_status', 'report_task_result'].sort(),
    );
  });

  it('report_status, ask_user, get_user_response, acknowledge_response, report_task_result round-trip', async () => {
    const st = text(await client.callTool({ name: 'report_status', arguments: { state: 'working', taskId: s.t1.id, message: 'via mcp' } }));
    expect(st.event.type).toBe('agent.status');

    const asked = text(await client.callTool({ name: 'ask_user', arguments: { taskId: s.t1.id, question: 'MCP?', why: 'test', options: ['yes', 'no'], blocking: true } }));
    const questionId = asked.question.id as string;
    expect(asked.question.status).toBe('open');

    const pending = text(await client.callTool({ name: 'get_user_response', arguments: { questionId, waitSec: 0 } }));
    expect(pending.status).toBe('pending');

    await h.owner('POST', `/api/questions/${questionId}/responses`, { clientRequestId: 'mcp-r1', questionVersion: 1, option: 'yes' });
    const answered = text(await client.callTool({ name: 'get_user_response', arguments: { questionId, waitSec: 5 } }));
    expect(answered.status).toBe('answered');
    expect(answered.response.option).toBe('yes');
    expect(answered.response.state).toBe('delivered');

    const acked = text(await client.callTool({ name: 'acknowledge_response', arguments: { questionId, responseId: answered.response.id } }));
    expect(acked.response.state).toBe('acknowledged');

    const result = text(
      await client.callTool({
        name: 'report_task_result',
        arguments: { taskId: s.t1.id, status: 'completed', summary: 'done via mcp', branch: 'wt/a', testsRun: [{ command: 'npm test', passed: true, summary: 'ok' }] },
      }),
    );
    expect(result.task.status).toBe('ready_for_review');
  });

  it('surfaces gone and API errors as tool errors/status without throwing', async () => {
    const q1 = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    await ask(h, s.tok1, s.a1.id, s.t1.id, { supersedesQuestionId: q1.id });
    const gone = text(await client.callTool({ name: 'get_user_response', arguments: { questionId: q1.id, waitSec: 0 } }));
    expect(gone.status).toBe('gone');
    const r = await client.callTool({ name: 'acknowledge_response', arguments: { questionId: q1.id, responseId: 'nope' } });
    expect(r.isError).toBe(true);
    expect(text(r).httpStatus).toBe(410);
  });
});
