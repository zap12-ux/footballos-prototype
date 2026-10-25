import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  dataDir: string;
  repoRoot: string;
  staleAfterMin: number;
  leadPickupAfterSec: number;
  uiDist: string;
}

/** Directory of this package (tools/agent-console), independent of the cwd. */
export const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const repoRoot = overrides.repoRoot ?? process.env.CONSOLE_REPO_ROOT ?? path.resolve(packageDir, '..', '..');
  const dataDir =
    overrides.dataDir ??
    process.env.CONSOLE_DATA_DIR ??
    process.env.DATA_DIR ??
    path.join(repoRoot, '.data', 'console');
  return {
    port: overrides.port ?? intEnv('CONSOLE_PORT', 4800),
    dataDir,
    repoRoot,
    staleAfterMin: overrides.staleAfterMin ?? intEnv('STALE_AFTER_MIN', 20),
    leadPickupAfterSec: overrides.leadPickupAfterSec ?? intEnv('LEAD_PICKUP_AFTER_SEC', 90),
    uiDist: overrides.uiDist ?? path.resolve(packageDir, '..', 'agent-console-ui', 'dist'),
  };
}
