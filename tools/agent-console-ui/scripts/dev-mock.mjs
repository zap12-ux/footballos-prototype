#!/usr/bin/env node
/** Starts the FIXTURE mock API on 4802 and Vite on 4801 proxying /api to it. Dev only. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = process.env.MOCK_PORT ?? '4802';

const mock = spawn(process.execPath, [path.join(here, 'mock-server.mjs')], { stdio: 'inherit', env: { ...process.env, MOCK_PORT: port } });
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', '4801', '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CONSOLE_API_ORIGIN: `http://127.0.0.1:${port}` },
});
const stop = () => {
  mock.kill();
  vite.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', stop);
mock.on('exit', (code) => {
  if (code) vite.kill();
});
