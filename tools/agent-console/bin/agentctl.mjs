#!/usr/bin/env node
// agentctl: the agent-side CLI for the Agent Build Console (CONTRACT.md §7).
// Env: CONSOLE_URL (default http://127.0.0.1:4800), CONSOLE_AGENT_ID, CONSOLE_AGENT_TOKEN.
// Exit codes: 0 ok, 1 error, 2 config/connection, 3 question gone (410), 4 wait timeout.
import { api, describeError, expectOk, fail, newClientId, parseArgs, printJson, readJsonFile, splitList, splitPipe } from './_common.mjs';

const USAGE = `usage:
  agentctl status --state <working|reviewing|idle|waiting_on_dependency> [--task <taskId>] --message "..."
  agentctl ask --task <taskId> --question "..." --why "..." [--options "a|b"] [--recommend "a"] [--blocking] [--supersedes <questionId>]
  agentctl wait <questionId> [--timeout 900 | --poll-until-answered] [--ack] [--note "..."]
       --poll-until-answered: no timeout; keeps long-polling (wait=25) and prints a heartbeat line on stderr every 5 minutes
  agentctl ack <questionId> <responseId> [--note "..."]
  agentctl result --task <taskId> --status <completed|failed> --summary "..." --branch <branch> [--commit <sha>] [--changed-files a,b] [--tests-json tests.json] [--limitations "a|b"] [--follow-ups "a|b"]
  agentctl log --message "..."
  agentctl whoami
Options: --client-id <id> overrides the generated clientRequestId/clientEventId (for retries).
Env: CONSOLE_URL, CONSOLE_AGENT_ID, CONSOLE_AGENT_TOKEN`;

const { flags, positional } = parseArgs(process.argv.slice(2));
const cmd = positional[0];
if (!cmd || flags.help || cmd === 'help') {
  process.stdout.write(USAGE + '\n');
  process.exit(cmd ? 0 : 1);
}

const agentId = process.env.CONSOLE_AGENT_ID;
const token = process.env.CONSOLE_AGENT_TOKEN;
if (!agentId || !token) fail('CONSOLE_AGENT_ID and CONSOLE_AGENT_TOKEN must be set', 2);
const base = `/api/agent/${encodeURIComponent(agentId)}`;
const call = (method, p, body) => api(token, method, base + p, body);
const need = (name) => {
  const v = flags[name];
  if (v === undefined || v === true || v === '') fail(`--${name} is required\n${USAGE}`);
  return String(v);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEARTBEAT_MS = 5 * 60 * 1000;

async function waitForAnswer(questionId, { timeoutSec, ack, note, pollUntilAnswered, heartbeatMs = HEARTBEAT_MS }) {
  const started = Date.now();
  const deadline = pollUntilAnswered ? Infinity : started + timeoutSec * 1000;
  // Heartbeat on a timer (not between polls: a single long-poll can hold the request for 25 s).
  // It goes to stderr so stdout stays a single JSON document; unref so it never keeps the process alive.
  const heartbeat = pollUntilAnswered
    ? setInterval(() => {
        const minutes = Math.round((Date.now() - started) / 60000);
        process.stderr.write(`heartbeat: still waiting for an answer to ${questionId} (${minutes} min elapsed)\n`);
      }, heartbeatMs)
    : null;
  heartbeat?.unref();
  for (;;) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining <= 0) fail(`timed out after ${timeoutSec}s waiting for an answer to ${questionId}`, 4);
    const wait = Math.min(25, remaining);
    const res = await call('GET', `/questions/${encodeURIComponent(questionId)}/response?wait=${wait}`);
    if (res.status === 200) {
      const out = res.body;
      if (ack) {
        const ackRes = await call('POST', `/questions/${encodeURIComponent(questionId)}/ack`, {
          responseId: out.response.id,
          note: note ?? null,
        });
        if (ackRes.status !== 200) fail(`answer received but ack failed: ${describeError(ackRes)}`);
        out.response = ackRes.body.response;
        out.acknowledged = true;
      }
      if (heartbeat) clearInterval(heartbeat);
      printJson(out);
      return;
    }
    if (res.status === 204) continue;
    if (res.status === 410) fail(`question ${questionId} is no longer answerable: ${describeError(res)}`, 3);
    if (res.status === 401 || res.status === 404) fail(describeError(res), 2);
    // Transient (5xx/network): back off briefly and retry until the deadline.
    process.stderr.write(`warn: ${describeError(res)}; retrying\n`);
    await sleep(2000);
  }
}

switch (cmd) {
  case 'status': {
    const res = await call('POST', '/status', {
      clientEventId: flags['client-id'] ? String(flags['client-id']) : newClientId(),
      state: need('state'),
      taskId: flags.task ? String(flags.task) : null,
      message: flags.message ? String(flags.message) : '',
    });
    expectOk(res);
    break;
  }
  case 'ask': {
    const res = await call('POST', '/questions', {
      clientRequestId: flags['client-id'] ? String(flags['client-id']) : newClientId(),
      taskId: need('task'),
      question: need('question'),
      why: flags.why ? String(flags.why) : '',
      options: splitPipe(flags.options),
      recommendation: flags.recommend ? String(flags.recommend) : null,
      blocking: flags.blocking === true || flags.blocking === 'true',
      supersedesQuestionId: flags.supersedes ? String(flags.supersedes) : null,
    });
    if (res.status === 200 || res.status === 201) {
      printJson({ questionId: res.body.question.id, question: res.body.question });
    } else {
      fail(describeError(res));
    }
    break;
  }
  case 'wait': {
    const questionId = positional[1];
    if (!questionId) fail(`questionId is required\n${USAGE}`);
    const pollUntilAnswered = flags['poll-until-answered'] === true || flags['poll-until-answered'] === 'true';
    if (pollUntilAnswered && flags.timeout !== undefined) fail('--poll-until-answered and --timeout are mutually exclusive');
    const timeoutSec = flags.timeout ? Number(flags.timeout) : 900;
    if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) fail('--timeout must be a positive number of seconds');
    // Undocumented, for tests only: shorten the heartbeat interval (milliseconds).
    const heartbeatMs = process.env.AGENTCTL_HEARTBEAT_MS ? Number(process.env.AGENTCTL_HEARTBEAT_MS) : undefined;
    await waitForAnswer(questionId, {
      timeoutSec,
      ack: flags.ack === true || flags.ack === 'true',
      note: flags.note ? String(flags.note) : null,
      pollUntilAnswered,
      ...(Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? { heartbeatMs } : {}),
    });
    break;
  }
  case 'ack': {
    const [, questionId, responseId] = positional;
    if (!questionId || !responseId) fail(`questionId and responseId are required\n${USAGE}`);
    const res = await call('POST', `/questions/${encodeURIComponent(questionId)}/ack`, { responseId, note: flags.note ? String(flags.note) : null });
    if (res.status === 410) fail(describeError(res), 3);
    expectOk(res);
    break;
  }
  case 'result': {
    const taskId = need('task');
    const testsRun = flags['tests-json'] ? readJsonFile(String(flags['tests-json'])) : [];
    if (!Array.isArray(testsRun)) fail('--tests-json must contain a JSON array of { command, passed, summary }');
    const res = await call('POST', `/tasks/${encodeURIComponent(taskId)}/result`, {
      clientRequestId: flags['client-id'] ? String(flags['client-id']) : newClientId(),
      status: need('status'),
      summary: need('summary'),
      branch: need('branch'),
      commit: flags.commit ? String(flags.commit) : null,
      changedFiles: splitList(flags['changed-files']),
      testsRun,
      limitations: splitPipe(flags.limitations),
      followUps: splitPipe(flags['follow-ups']),
    });
    expectOk(res);
    break;
  }
  case 'log': {
    const res = await call('POST', '/log', {
      clientEventId: flags['client-id'] ? String(flags['client-id']) : newClientId(),
      message: need('message'),
    });
    expectOk(res);
    break;
  }
  case 'whoami': {
    printJson({ consoleUrl: process.env.CONSOLE_URL || 'http://127.0.0.1:4800', agentId });
    break;
  }
  default:
    fail(`unknown command "${cmd}"\n${USAGE}`);
}
