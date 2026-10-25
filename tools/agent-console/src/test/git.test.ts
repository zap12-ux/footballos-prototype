import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitInfoCache, gitAgentInfo, isSafeBranchName } from '../git.js';

let repo: string;
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-git-'));
  git('init', '-q', '-b', 'integration');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'wt/feature');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a2\n');
  git('add', '.');
  git('commit', '-q', '-m', 'feature work');
  git('checkout', '-q', '-b', 'wt/merged', 'integration');
  git('checkout', '-q', 'integration');
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('git corroboration', () => {
  it('reports ahead commits, changed files and merge status', async () => {
    const info = await gitAgentInfo(repo, 'wt/feature');
    expect(info.exists).toBe(true);
    expect(info.ahead).toBe(1);
    expect(info.commits[0]!.subject).toBe('feature work');
    expect(info.changedFiles.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(info.changedFiles.find((f) => f.path === 'b.txt')!.status).toBe('A');
    expect(info.mergedIntoIntegration).toBe(false);
    const merged = await gitAgentInfo(repo, 'wt/merged');
    expect(merged.ahead).toBe(0);
    expect(merged.mergedIntoIntegration).toBe(true);
  });

  it('handles missing or unsafe branches gracefully', async () => {
    const missing = await gitAgentInfo(repo, 'wt/nope');
    expect(missing.exists).toBe(false);
    expect(missing.error).toContain('not found');
    expect(await gitAgentInfo(repo, null)).toMatchObject({ branch: null, exists: false, ahead: 0 });
    expect((await gitAgentInfo(repo, '--upload-pack=evil')).error).toBe('invalid branch name');
    expect(isSafeBranchName('wt/a-b.c')).toBe(true);
    expect(isSafeBranchName('-x')).toBe(false);
    expect(isSafeBranchName('a..b')).toBe(false);
  });

  it('caches per agent for the ttl', async () => {
    const cache = new GitInfoCache(repo, 10_000);
    const a = await cache.get('agent-1', 'wt/feature');
    const b = await cache.get('agent-1', 'wt/feature');
    expect(b.computedAt).toBe(a.computedAt);
    const c = await cache.get('agent-2', 'wt/feature');
    expect(c).not.toBe(a);
  });
});
