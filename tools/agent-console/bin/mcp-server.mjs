#!/usr/bin/env node
// Stdio MCP server for agents. Requires `npm run build -w tools/agent-console` first.
// Env: CONSOLE_URL, CONSOLE_AGENT_ID, CONSOLE_AGENT_TOKEN.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'mcp-server.js');
if (!existsSync(dist)) {
  process.stderr.write(`[agent-console-mcp] ${dist} not found. Run: npm run build -w tools/agent-console\n`);
  process.exit(1);
}
const mod = await import(dist);
await mod.main();
