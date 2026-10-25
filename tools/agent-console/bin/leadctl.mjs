#!/usr/bin/env node
// leadctl: owner/lead CLI for the Agent Build Console (CONTRACT.md §7).
// Owner token: CONSOLE_OWNER_TOKEN or <DATA_DIR>/owner-token. Env: CONSOLE_URL, CONSOLE_DATA_DIR.
import { api, expectOk, fail, parseArgs, printJson, readJsonFile, readOwnerToken, splitList, splitPipe } from './_common.mjs';

const USAGE = `usage:
  leadctl run create --kind <live|fixture> --label "..."
  leadctl runs
  leadctl agent register --run <runId> --name "..." --role "..." [--worktree <path>] [--branch <branch>] [--runtime-agent-id <id>]
       prints { agent, agentToken }; the token is shown once. Hand the agent CONSOLE_AGENT_ID/CONSOLE_AGENT_TOKEN.
  leadctl agent set <agentId> [--branch <b>] [--worktree <p>] [--runtime-agent-id <id>] [--blocked-by <taskId>]
  leadctl task create --run <runId> [--id T1] --title "..." --objective "..." [--criteria "a|b"] [--agent <agentId>] [--depends-on T0,T2] [--allowed-paths "apps/web/**|packages/**"] [--branch <b>]
  leadctl task set <taskId> [--status <status>] [--agent <agentId>] [--depends-on ...] [--verification <verificationId>]
  leadctl verify --task <taskId> --kind <tests|integration_merge|browser|git|manual> --summary "..." --passed <true|false> [--command "..."] [--evidence-json file.json]
  leadctl runtime-event --type <agent.spawned|agent.completed|agent.failed|agent.resumed|message.delivered|lead.note> [--agent <id>] [--task <id>] [--response <id>] [--run <id>] [--details-json file.json | --details '{"k":"v"}']
  leadctl answer <questionId> --version <n> (--option "a" | --text "...") [--client-id <id>]
  leadctl questions [--run <runId>] [--status open]
  leadctl inbox [--run <runId>]
  leadctl state [--run <runId>]
  leadctl git <agentId>
Env: CONSOLE_URL, CONSOLE_OWNER_TOKEN or CONSOLE_DATA_DIR (reads <dir>/owner-token)`;

const { flags, positional } = parseArgs(process.argv.slice(2));
const [cmd, sub, arg3] = positional;
if (!cmd || flags.help || cmd === 'help') {
  process.stdout.write(USAGE + '\n');
  process.exit(cmd ? 0 : 1);
}
const token = readOwnerToken();
const call = (method, p, body) => api(token, method, p, body);
const need = (name) => {
  const v = flags[name];
  if (v === undefined || v === true || v === '') fail(`--${name} is required\n${USAGE}`);
  return String(v);
};
const opt = (name) => (flags[name] === undefined || flags[name] === true ? undefined : String(flags[name]));
const runQuery = () => (opt('run') ? `?runId=${encodeURIComponent(opt('run'))}` : '');
const parseBool = (v) => (v === 'true' || v === true ? true : v === 'false' ? false : fail(`expected true|false, got ${v}`));

switch (`${cmd} ${sub ?? ''}`.trim()) {
  case 'run create':
    expectOk(await call('POST', '/api/runs', { kind: need('kind'), label: need('label') }));
    break;
  case 'runs':
    expectOk(await call('GET', '/api/runs'));
    break;
  case 'agent register': {
    const res = await call('POST', '/api/agents', {
      runId: need('run'),
      name: need('name'),
      role: need('role'),
      worktree: opt('worktree') ?? null,
      branch: opt('branch') ?? null,
      runtimeAgentId: opt('runtime-agent-id') ?? null,
    });
    if (res.status === 201) {
      printJson(res.body);
      process.stderr.write(
        `registered agent ${res.body.agent.id}. Give the agent:\n  CONSOLE_AGENT_ID=${res.body.agent.id}\n  CONSOLE_AGENT_TOKEN=<the agentToken above; shown once>\n`,
      );
    } else expectOk(res);
    break;
  }
  case 'agent set': {
    if (!arg3) fail(`agentId is required\n${USAGE}`);
    const body = {};
    if (opt('branch') !== undefined) body.branch = opt('branch');
    if (opt('worktree') !== undefined) body.worktree = opt('worktree');
    if (opt('runtime-agent-id') !== undefined) body.runtimeAgentId = opt('runtime-agent-id');
    if (opt('blocked-by') !== undefined) body.blockedByTaskId = opt('blocked-by') === 'none' ? null : opt('blocked-by');
    expectOk(await call('PATCH', `/api/agents/${encodeURIComponent(arg3)}`, body));
    break;
  }
  case 'task create':
    expectOk(
      await call('POST', '/api/tasks', {
        runId: need('run'),
        id: opt('id'),
        title: need('title'),
        objective: need('objective'),
        acceptanceCriteria: splitPipe(flags.criteria),
        agentId: opt('agent') ?? null,
        dependsOn: splitList(flags['depends-on']),
        allowedPaths: splitPipe(flags['allowed-paths']),
        branch: opt('branch') ?? null,
      }),
    );
    break;
  case 'task set': {
    if (!arg3) fail(`taskId is required\n${USAGE}`);
    const body = {};
    if (opt('status')) body.status = opt('status');
    if (opt('agent') !== undefined) body.agentId = opt('agent') === 'none' ? null : opt('agent');
    if (flags['depends-on'] !== undefined) body.dependsOn = splitList(flags['depends-on']);
    if (flags['allowed-paths'] !== undefined) body.allowedPaths = splitPipe(flags['allowed-paths']);
    if (opt('branch') !== undefined) body.branch = opt('branch');
    if (opt('verification')) body.verificationId = opt('verification');
    expectOk(await call('PATCH', `/api/tasks/${encodeURIComponent(arg3)}`, body));
    break;
  }
  case 'verify':
    expectOk(
      await call('POST', '/api/verifications', {
        taskId: need('task'),
        kind: need('kind'),
        command: opt('command') ?? null,
        resultSummary: need('summary'),
        passed: parseBool(need('passed')),
        evidence: flags['evidence-json'] ? readJsonFile(String(flags['evidence-json'])) : {},
      }),
    );
    break;
  case 'runtime-event': {
    let details = {};
    if (flags['details-json']) details = readJsonFile(String(flags['details-json']));
    else if (opt('details')) {
      try {
        details = JSON.parse(opt('details'));
      } catch {
        fail('--details must be a JSON object string');
      }
    }
    expectOk(
      await call('POST', '/api/runtime/events', {
        type: need('type'),
        runId: opt('run') ?? null,
        agentId: opt('agent') ?? null,
        taskId: opt('task') ?? null,
        responseId: opt('response') ?? null,
        details,
      }),
    );
    break;
  }
  case 'answer': {
    if (!sub) fail(`questionId is required\n${USAGE}`);
    const res = await call('POST', `/api/questions/${encodeURIComponent(sub)}/responses`, {
      clientRequestId: opt('client-id') ?? crypto.randomUUID(),
      questionVersion: Number(need('version')),
      option: opt('option') ?? null,
      text: opt('text') ?? null,
    });
    expectOk(res);
    break;
  }
  case 'questions': {
    const q = new URLSearchParams();
    if (opt('run')) q.set('runId', opt('run'));
    if (opt('status')) q.set('status', opt('status'));
    const qs = q.toString();
    expectOk(await call('GET', `/api/questions${qs ? '?' + qs : ''}`));
    break;
  }
  case 'inbox':
    expectOk(await call('GET', `/api/lead/inbox${runQuery()}`));
    break;
  case 'state':
    expectOk(await call('GET', `/api/state${runQuery()}`));
    break;
  case 'git': {
    if (!sub) fail(`agentId is required\n${USAGE}`);
    expectOk(await call('GET', `/api/git/agents/${encodeURIComponent(sub)}`));
    break;
  }
  default:
    fail(`unknown command "${positional.join(' ')}"\n${USAGE}`);
}
