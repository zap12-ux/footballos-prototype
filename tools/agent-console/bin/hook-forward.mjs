#!/usr/bin/env node
// Claude Code hook forwarder: reads the hook JSON from stdin (SubagentStart / SubagentStop / Stop
// and similar shapes) and posts it to the console as a runtime event of type `lead.note` with
// `details.hook`. Always exits 0 so a console outage never blocks the session.
//
// STATUS: not yet exercised in a live Claude Code session. Hooks are read at session start, so
// adding this to .claude/settings.json takes effect for the next session only. See README.md.
import { api, readOwnerToken } from './_common.mjs';

const MAX_FIELD = 2000;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 3000).unref();
  });
}

const clip = (v) => (typeof v === 'string' && v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) + '…' : v);

try {
  const raw = await readStdin();
  let hook = {};
  try {
    hook = raw ? JSON.parse(raw) : {};
  } catch {
    hook = { unparsed: clip(raw) };
  }
  const details = {
    hook: {
      event: hook.hook_event_name ?? hook.event ?? 'unknown',
      sessionId: hook.session_id ?? null,
      runtimeAgentId: hook.agent_id ?? null,
      agentType: hook.agent_type ?? null,
      agentName: hook.agent_name ?? null,
      transcriptPath: hook.transcript_path ?? hook.agent_transcript_path ?? null,
      cwd: hook.cwd ?? null,
      stopHookActive: hook.stop_hook_active ?? null,
      lastAssistantMessage: clip(hook.last_assistant_message ?? null),
      receivedAt: new Date().toISOString(),
    },
  };
  const token = readOwnerToken();
  const res = await api(token, 'POST', '/api/runtime/events', {
    type: 'lead.note',
    agentId: process.env.CONSOLE_AGENT_ID || null,
    details,
  });
  if (res.status !== 201) process.stderr.write(`[hook-forward] console answered ${res.status}: ${JSON.stringify(res.body)}\n`);
} catch (err) {
  process.stderr.write(`[hook-forward] ${err instanceof Error ? err.message : String(err)}\n`);
}
process.exit(0);
