/**
 * Corroboration from git: runs `git` with argument arrays only (no shell), in the repo root.
 * Branch names are validated before being passed and always preceded by `--` where git allows it.
 */
import { execFile } from 'node:child_process';

export interface GitAgentInfo {
  branch: string | null;
  exists: boolean;
  ahead: number;
  commits: { sha: string; shortSha: string; subject: string; authoredAt: string }[];
  changedFiles: { status: string; path: string }[];
  mergedIntoIntegration: boolean;
  base: string;
  computedAt: string;
  error?: string;
}

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
export const isSafeBranchName = (b: string) => BRANCH_RE.test(b) && !b.includes('..') && !b.endsWith('/');

function git(repoRoot: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoRoot, ...args], { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
        ? ((err as unknown as { code: number }).code)
        : err
          ? 1
          : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export async function gitAgentInfo(repoRoot: string, branch: string | null, base = 'integration'): Promise<GitAgentInfo> {
  const computedAt = new Date().toISOString();
  const empty: GitAgentInfo = {
    branch,
    exists: false,
    ahead: 0,
    commits: [],
    changedFiles: [],
    mergedIntoIntegration: false,
    base,
    computedAt,
  };
  if (!branch) return { ...empty, error: 'agent has no branch recorded' };
  if (!isSafeBranchName(branch) || !isSafeBranchName(base)) return { ...empty, error: 'invalid branch name' };

  const branchRef = await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (branchRef.code !== 0) return { ...empty, error: `branch ${branch} not found in ${repoRoot}` };
  const baseRef = await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`]);
  if (baseRef.code !== 0) return { ...empty, exists: true, error: `base branch ${base} not found` };

  const [log, diff, merged] = await Promise.all([
    git(repoRoot, ['log', '--format=%H%x1f%h%x1f%s%x1f%aI', `${base}..${branch}`, '--']),
    git(repoRoot, ['diff', '--name-status', `${base}...${branch}`, '--']),
    git(repoRoot, ['merge-base', '--is-ancestor', branch, base]),
  ]);
  const commits = log.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, authoredAt] = line.split('\x1f');
      return { sha: sha ?? '', shortSha: shortSha ?? '', subject: subject ?? '', authoredAt: authoredAt ?? '' };
    });
  const changedFiles = diff.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status: (status ?? '').trim(), path: rest[rest.length - 1] ?? '' };
    });
  return {
    branch,
    exists: true,
    ahead: commits.length,
    commits,
    changedFiles,
    mergedIntoIntegration: merged.code === 0,
    base,
    computedAt,
  };
}

/** 10 s cache keyed by agent id so the UI can poll freely. */
export class GitInfoCache {
  private readonly entries = new Map<string, { at: number; value: Promise<GitAgentInfo> }>();
  constructor(
    private readonly repoRoot: string,
    private readonly ttlMs = 10_000,
  ) {}

  get(agentId: string, branch: string | null): Promise<GitAgentInfo> {
    const hit = this.entries.get(agentId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = gitAgentInfo(this.repoRoot, branch);
    this.entries.set(agentId, { at: Date.now(), value });
    return value;
  }
}
