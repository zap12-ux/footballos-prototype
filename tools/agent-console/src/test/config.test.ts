import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorkspaceRoot, loadConfig, packageDir, resolveDataDir, resolveRepoRoot } from '../config.js';

const saved = { ...process.env };
afterEach(() => {
  for (const k of ['CONSOLE_DATA_DIR', 'DATA_DIR', 'CONSOLE_REPO_ROOT']) delete process.env[k];
  Object.assign(process.env, saved);
});

describe('data dir resolution (D-4)', () => {
  it('finds the monorepo root (nearest package.json with workspaces) above the package dir', () => {
    const root = findWorkspaceRoot(packageDir);
    expect(root).not.toBeNull();
    expect(root).not.toBe(packageDir);
    const pkg = JSON.parse(fs.readFileSync(path.join(root!, 'package.json'), 'utf8')) as { workspaces?: unknown };
    expect(pkg.workspaces).toBeDefined();
    expect(packageDir.startsWith(root!)).toBe(true);
    expect(resolveRepoRoot({})).toBe(root);
  });

  it('returns null when no workspace root exists above the start directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'leaf' }));
      // os.tmpdir() has no workspace package.json above it
      expect(findWorkspaceRoot(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves a relative CONSOLE_DATA_DIR against the repo root, not the package dir or cwd', () => {
    const repoRoot = resolveRepoRoot({});
    expect(resolveDataDir(repoRoot, { CONSOLE_DATA_DIR: '.data/wt-k5-console' })).toBe(path.join(repoRoot, '.data', 'wt-k5-console'));
    expect(resolveDataDir(repoRoot, { DATA_DIR: 'x/y' })).toBe(path.join(repoRoot, 'x', 'y'));
    expect(resolveDataDir(repoRoot, {})).toBe(path.join(repoRoot, '.data', 'console'));
    expect(resolveDataDir(repoRoot, { CONSOLE_DATA_DIR: '/abs/dir/' })).toBe(path.normalize('/abs/dir/'));
    // loadConfig applies the same rule from process.env (cwd during tests is the package dir)
    process.env.CONSOLE_DATA_DIR = '.data/rel';
    const cfg = loadConfig();
    expect(cfg.dataDir).toBe(path.join(repoRoot, '.data', 'rel'));
    expect(cfg.dataDir.startsWith(packageDir)).toBe(false);
  });

  it('honours CONSOLE_REPO_ROOT for both repoRoot and a relative data dir', () => {
    const root = path.resolve(os.tmpdir(), 'some-repo');
    expect(resolveRepoRoot({ CONSOLE_REPO_ROOT: root })).toBe(root);
    process.env.CONSOLE_REPO_ROOT = root;
    process.env.CONSOLE_DATA_DIR = '.data/x';
    expect(loadConfig().dataDir).toBe(path.join(root, '.data', 'x'));
  });
});
