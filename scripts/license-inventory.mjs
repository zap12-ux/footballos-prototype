#!/usr/bin/env node
// Dependency and license inventory for every npm workspace.
//
// Walks each workspace's dependencies through the installed node_modules tree (Node's
// resolution order), reads each installed package.json, and writes
// docs/ops/DEPENDENCY_INVENTORY.md. Exits 1 when a package's license is outside the
// allowed set and the package is not listed in scripts/license-allowlist.json with the
// same license string.
//
// Usage: node scripts/license-inventory.mjs [--out <path>]
// Run `npm ci` first; the script reads what is installed, not the registry.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'MPL-2.0',
]);

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'docs/ops/DEPENDENCY_INVENTORY.md');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rootPkg = readJson(join(ROOT, 'package.json'));
const allowlist = existsSync(join(ROOT, 'scripts/license-allowlist.json'))
  ? readJson(join(ROOT, 'scripts/license-allowlist.json')).packages ?? {}
  : {};

// Expand "apps/*"-style workspace globs (only trailing /* is used in this repo).
function workspaceDirs() {
  const dirs = [];
  for (const pattern of rootPkg.workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const base = join(ROOT, pattern.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base).sort()) {
        if (existsSync(join(base, name, 'package.json'))) dirs.push(join(base, name));
      }
    } else if (existsSync(join(ROOT, pattern, 'package.json'))) {
      dirs.push(join(ROOT, pattern));
    }
  }
  return dirs;
}

// Node resolution: <from>/node_modules/<name>, then each parent directory up to ROOT.
function resolvePackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === ROOT || dir === dirname(dir)) return null;
    dir = dirname(dir);
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean);
    if (types.length) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return 'UNKNOWN';
}

// Accepts plain SPDX ids and simple OR/AND expressions; an OR passes if any branch passes.
function isAllowed(expr) {
  const cleaned = expr.replace(/[()]/g, ' ').trim();
  return cleaned.split(/\s+OR\s+/).some((branch) =>
    branch.split(/\s+AND\s+/).every((id) => ALLOWED.has(id.trim())));
}

const workspaces = workspaceDirs().map((dir) => ({ dir, pkg: readJson(join(dir, 'package.json')) }));
const workspaceNames = new Set(workspaces.map((w) => w.pkg.name));

// key = install path; value = { name, version, license, workspaces: Map<ws, 'prod'|'dev'> }
const found = new Map();
const missing = [];

function walk(wsName, kind, depName, fromDir, seen) {
  if (workspaceNames.has(depName)) return; // internal workspace links are not third-party
  const path = resolvePackage(depName, fromDir);
  if (!path) {
    missing.push(`${wsName}: ${depName} (from ${relative(ROOT, fromDir) || '.'})`);
    return;
  }
  if (seen.has(path)) return;
  seen.add(path);
  const pkg = readJson(join(path, 'package.json'));
  let entry = found.get(path);
  if (!entry) {
    entry = { name: pkg.name ?? depName, version: pkg.version ?? '?', license: licenseOf(pkg), uses: new Map() };
    found.set(path, entry);
  }
  // prod wins over dev when a package is reachable both ways from the same workspace.
  if (entry.uses.get(wsName) !== 'prod') entry.uses.set(wsName, kind);
  const children = { ...pkg.dependencies, ...pkg.optionalDependencies };
  for (const child of Object.keys(children)) {
    const childPath = resolvePackage(child, path);
    // Optional dependencies that are not installed (other platforms) are expected.
    if (!childPath && pkg.optionalDependencies?.[child]) continue;
    walk(wsName, kind, child, path, seen);
  }
}

for (const { dir, pkg } of workspaces) {
  // Walk prod first with its own visited set so dev-only reachability cannot mask prod use.
  const prodSeen = new Set();
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    walk(pkg.name, 'prod', dep, dir, prodSeen);
  }
  const devSeen = new Set(prodSeen);
  for (const dep of Object.keys(pkg.devDependencies ?? {})) walk(pkg.name, 'dev', dep, dir, devSeen);
}

const rows = [...found.values()]
  .flatMap((e) => [...e.uses].map(([ws, kind]) => ({ ...e, ws, kind })))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.ws.localeCompare(b.ws));

const violations = [];
const allowlisted = [];
for (const e of found.values()) {
  if (isAllowed(e.license)) continue;
  const entry = allowlist[e.name];
  if (entry && entry.license === e.license) allowlisted.push({ ...e, reason: entry.reason });
  else violations.push(e);
}

const summary = new Map();
for (const e of found.values()) summary.set(e.license, (summary.get(e.license) ?? 0) + 1);

const esc = (s) => String(s).replace(/\|/g, '\\|');
const lines = [
  '# Dependency and license inventory',
  '',
  'Generated by `node scripts/license-inventory.mjs` from the installed `node_modules` tree.',
  'Do not edit by hand; rerun after any dependency change.',
  '',
  `Allowed licenses: ${[...ALLOWED].join(', ')}. Anything else must appear in`,
  '`scripts/license-allowlist.json` with the exact license string and a reason.',
  '',
  `Workspaces: ${workspaces.map((w) => `\`${w.pkg.name}\``).join(', ') || 'none'}.`,
  `Installed third-party packages: ${found.size}.`,
  '',
  '## Licenses',
  '',
  '| License | Packages |',
  '| --- | --- |',
  ...[...summary].sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${esc(l)} | ${n} |`),
  '',
  '## Exceptions',
  '',
];
if (!allowlisted.length && !violations.length) lines.push('None.', '');
for (const e of allowlisted) lines.push(`- **${e.name}@${e.version}** (${e.license}): allowlisted. ${e.reason}`);
for (const e of violations) lines.push(`- **${e.name}@${e.version}** (${e.license}): **not allowed and not allowlisted.**`);
if (allowlisted.length || violations.length) lines.push('');
if (missing.length) {
  lines.push('## Unresolved dependencies', '', 'Declared but not found in node_modules (run `npm ci`):', '');
  for (const m of missing) lines.push(`- ${m}`);
  lines.push('');
}
lines.push(
  '## Packages',
  '',
  '| Package | Version | License | Workspace | Scope |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${esc(r.name)} | ${esc(r.version)} | ${esc(r.license)} | ${esc(r.ws)} | ${r.kind} |`),
  '',
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'));
console.log(`Wrote ${relative(ROOT, OUT)}: ${found.size} packages, ${allowlisted.length} allowlisted, ${violations.length} violations.`);
if (missing.length) console.error(`${missing.length} declared dependencies not installed; run npm ci.`);
for (const e of violations) console.error(`License not allowed: ${e.name}@${e.version} (${e.license})`);
process.exit(violations.length || missing.length ? 1 : 0);
