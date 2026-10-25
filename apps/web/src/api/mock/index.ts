/**
 * MockApi: the `Api` served from the fictional Winchester Hawks demo data in `./data.ts`.
 * It keeps mutations in memory for the life of the page, persists the signed-in session in
 * `sessionStorage` so a refresh stays signed in, and adds a small delay so loading states
 * are visible. Tests construct it with `latencyMs: 0` and `persist: false`.
 */
import type { Api, GamePlanBundle, Me, SignInResult, TeamSettings } from '../api';
import { ApiError } from '../api';
import type {
  Concept,
  GamePlanVersion,
  Invite,
  MediaAsset,
  PlanComment,
  ProcessingJob,
  ScheduleImport,
  ScheduledGame,
  StaffMembership,
  Unit,
  User,
} from '../contracts';
import { PLAN_SECTION_TEMPLATES } from '../contracts';
import * as demo from './data';
import { DEMO_MFA_CODE, DEMO_NOW } from './data';

export { DEMO_MFA_CODE, DEMO_NOW };

export interface MockApiOptions {
  latencyMs?: number;
  persist?: boolean;
  /** Start signed in as this demo user (tests). */
  signedInAs?: string;
}

const SESSION_KEY = 'footballos.mock.session.v1';

interface MockSession {
  userId: string;
  mfaVerified: boolean;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMockApi(options: MockApiOptions = {}): Api {
  const latency = options.latencyMs ?? 250;
  const persist = options.persist ?? true;

  // Fresh copies per instance so one test's mutations never reach another.
  const db = {
    team: clone(demo.team),
    seasons: clone(demo.seasons),
    users: clone(demo.users),
    memberships: clone(demo.memberships),
    invites: clone(demo.invites),
    opponents: clone(demo.opponents),
    games: clone(demo.games),
    assets: clone(demo.assets),
    jobs: clone(demo.jobs),
    segments: clone(demo.segments),
    findings: clone(demo.findings),
    plans: clone(demo.plans),
    planVersions: clone(demo.planVersions),
    planComments: clone(demo.planComments),
    playbookDocuments: clone(demo.playbookDocuments),
    playbookVersions: clone(demo.playbookVersions),
    concepts: clone(demo.concepts),
    players: clone(demo.players),
    depthCharts: clone(demo.depthCharts),
    packages: clone(demo.packages),
    settings: clone(demo.settings),
    imports: [] as ScheduleImport[],
  };

  let session: MockSession | null = options.signedInAs ? { userId: options.signedInAs, mfaVerified: true } : readSession();
  let pendingMfaUser: string | null = null;

  function readSession(): MockSession | null {
    if (!persist || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as MockSession) : null;
    } catch {
      return null;
    }
  }
  function writeSession(next: MockSession | null) {
    session = next;
    if (!persist || typeof window === 'undefined') return;
    try {
      if (next) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable: the session lives in memory only */
    }
  }

  const delay = <T>(value: T): Promise<T> =>
    latency > 0 ? new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency)) : Promise.resolve(clone(value));

  function fail(code: ApiError['code'], message: string, status: number, details?: Record<string, unknown>): never {
    throw new ApiError(code, message, status, details);
  }

  function requireUser(): { user: User & { password: string }; memberships: StaffMembership[] } {
    if (!session) fail('unauthorized', 'Sign in to continue.', 401);
    if (!session.mfaVerified) fail('unauthorized', 'Finish the verification step to continue.', 401, { mfaRequired: true });
    const user = db.users.find((u) => u.id === session!.userId);
    if (!user) fail('unauthorized', 'This session is no longer valid.', 401);
    return { user, memberships: db.memberships.filter((m) => m.userId === user.id && m.active) };
  }

  function requireTeam(teamId: string) {
    const { memberships } = requireUser();
    if (teamId !== db.team.id || !memberships.some((m) => m.teamId === teamId)) fail('not_found', 'Team not found.', 404);
    return memberships.find((m) => m.teamId === teamId)!;
  }

  function requireHeadCoach(teamId: string) {
    const membership = requireTeam(teamId);
    if (membership.role !== 'head_coach') fail('forbidden', 'Only the head coach can do this.', 403);
    return membership;
  }

  function me(): Me {
    const { user, memberships } = requireUser();
    const { password: _password, ...safe } = user;
    return { user: safe, mfaVerified: true, memberships };
  }

  function checkVersion(current: number, expected: number, what: string) {
    if (current !== expected) fail('conflict', `${what} version ${expected} expected, current is ${current}.`, 409, { currentVersion: current });
  }

  function gameOrFail(gameId: string): ScheduledGame {
    const game = db.games.find((g) => g.id === gameId);
    if (!game) fail('not_found', 'Game not found.', 404);
    requireTeam(game.teamId);
    return game;
  }

  function versionOrFail(versionId: string): GamePlanVersion {
    const version = db.planVersions.find((v) => v.id === versionId);
    if (!version) fail('not_found', 'Plan version not found.', 404);
    const plan = db.plans.find((p) => p.id === version.planId)!;
    requireTeam(plan.teamId);
    return version;
  }

  function canEditUnit(unit: Unit): boolean {
    const { memberships } = requireUser();
    return memberships.some((m) => m.role === 'head_coach' || ((m.role === 'coordinator' || m.role === 'position_coach') && m.units.includes(unit)));
  }

  const api: Api = {
    mode: 'mock',
    auth: {
      async me() {
        if (!session || !session.mfaVerified) return delay(null);
        try {
          return delay(me());
        } catch {
          return delay(null);
        }
      },
      async signIn({ email, password }): Promise<SignInResult> {
        const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
        if (!user || !password || password !== user.password) {
          await delay(null);
          fail('unauthorized', 'That email and password do not match a staff account.', 401);
        }
        if (user.mfaEnabled) {
          pendingMfaUser = user.id;
          writeSession({ userId: user.id, mfaVerified: false });
          return delay({ kind: 'mfa_required' } as SignInResult);
        }
        writeSession({ userId: user.id, mfaVerified: true });
        return delay({ kind: 'signed_in', me: me() } as SignInResult);
      },
      async verifyMfa({ code }) {
        const userId = pendingMfaUser ?? session?.userId ?? null;
        if (!userId) fail('unauthorized', 'Sign in first.', 401);
        if (code.replace(/\s+/g, '') !== DEMO_MFA_CODE) {
          await delay(null);
          fail('unauthorized', 'That code is not valid. Codes are six digits and expire quickly.', 401, { mfaRequired: true });
        }
        pendingMfaUser = null;
        writeSession({ userId, mfaVerified: true });
        return delay(me());
      },
      async signOut() {
        pendingMfaUser = null;
        writeSession(null);
        return delay(undefined);
      },
      async requestRecovery({ email }) {
        if (!email.includes('@')) fail('validation_error', 'Enter the email address of your staff account.', 400);
        // The real API never reveals whether an account exists.
        return delay(undefined);
      },
    },
    teams: {
      async list() {
        requireUser();
        return delay([db.team]);
      },
      async get(teamId) {
        requireTeam(teamId);
        return delay(db.team);
      },
      async staff(teamId) {
        requireTeam(teamId);
        const members = db.memberships
          .filter((m) => m.teamId === teamId)
          .map((m) => {
            const { password: _password, ...user } = db.users.find((u) => u.id === m.userId)!;
            return { ...m, user };
          });
        return delay({ members, invites: db.invites.filter((i) => i.teamId === teamId && !i.acceptedAt) });
      },
      async invite(teamId, input) {
        const actor = requireHeadCoach(teamId);
        if (!input.email.includes('@')) fail('validation_error', 'Enter a valid email address.', 400);
        if (db.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase()) || db.invites.some((i) => i.email.toLowerCase() === input.email.toLowerCase() && !i.acceptedAt)) {
          fail('conflict', 'That address already has an account or an open invite.', 409);
        }
        const invite: Invite = {
          id: newId('inv'), teamId, email: input.email, role: input.role, unit: input.unit,
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), acceptedAt: null, createdBy: actor.userId,
        };
        db.invites.push(invite);
        return delay(invite);
      },
      async updateMembership(teamId, membershipId, patch) {
        requireHeadCoach(teamId);
        const membership = db.memberships.find((m) => m.id === membershipId && m.teamId === teamId);
        if (!membership) fail('not_found', 'Staff member not found.', 404);
        Object.assign(membership, patch);
        return delay(membership);
      },
      async settings(teamId) {
        requireTeam(teamId);
        return delay(db.settings);
      },
      async updateSettings(teamId, patch) {
        requireHeadCoach(teamId);
        checkVersion(db.settings.version, patch.expectedVersion, 'Settings');
        const { expectedVersion: _expected, ...rest } = patch;
        const next: TeamSettings = { ...db.settings, ...rest, teamId, version: db.settings.version + 1 };
        db.settings = next;
        return delay(next);
      },
    },
    seasons: {
      async list(teamId) {
        requireTeam(teamId);
        return delay(db.seasons);
      },
      async opponents(teamId) {
        requireTeam(teamId);
        return delay(db.opponents);
      },
      async games(teamId, seasonId) {
        requireTeam(teamId);
        return delay(db.games.filter((g) => g.seasonId === seasonId));
      },
      async createGame(teamId, seasonId, input) {
        requireTeam(teamId);
        if (!db.seasons.some((s) => s.id === seasonId)) fail('not_found', 'Season not found.', 404);
        if (input.kind !== 'bye' && input.kind !== 'playoff' && !input.opponentId) fail('validation_error', 'Choose an opponent or mark the week as a bye.', 400);
        const ts = nowIso();
        const created: ScheduledGame = {
          id: newId('game'), teamId, seasonId, week: input.week, kind: input.kind, opponentId: input.opponentId, location: input.location,
          scheduledAt: input.scheduledAt, status: 'scheduled', result: null, notes: input.notes, version: 1, createdAt: ts, updatedAt: ts,
        };
        db.games.push(created);
        return delay(created);
      },
      async updateGame(gameId, patch) {
        const game = gameOrFail(gameId);
        checkVersion(game.version, patch.expectedVersion, 'Game');
        const { expectedVersion: _expected, ...rest } = patch;
        if (rest.status === 'final' && !(rest.result ?? game.result)) fail('validation_error', 'A final game needs a score.', 400);
        Object.assign(game, rest, { version: game.version + 1, updatedAt: nowIso() });
        return delay(game);
      },
      async previewImport(teamId, seasonId, file) {
        requireTeam(teamId);
        const lines = file.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) fail('validation_error', 'The file needs a header row and at least one game row.', 400);
        const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const col = (name: string) => header.indexOf(name);
        const errors: ScheduleImport['errors'] = [];
        const rows: NonNullable<ScheduleImport['previewRows']> = [];
        lines.slice(1).forEach((line, i) => {
          const cells = line.split(',').map((c) => c.trim());
          const week = col('week') >= 0 ? Number(cells[col('week')]) : NaN;
          const opponentName = col('opponent') >= 0 ? cells[col('opponent')] || null : null;
          const locationRaw = col('location') >= 0 ? cells[col('location')].toLowerCase() : '';
          const location = locationRaw === 'home' || locationRaw === 'away' || locationRaw === 'neutral' ? locationRaw : null;
          const dateRaw = col('date') >= 0 ? cells[col('date')] : '';
          const scheduledAt = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : null;
          if (dateRaw && !scheduledAt) errors.push({ row: i + 2, message: `Date "${dateRaw}" could not be read.` });
          if (!opponentName && locationRaw !== 'bye') errors.push({ row: i + 2, message: 'No opponent and not marked as a bye.' });
          rows.push({ week: Number.isNaN(week) ? null : week, kind: locationRaw === 'bye' || !opponentName ? 'bye' : 'regular', location, scheduledAt, opponentName });
        });
        const record: ScheduleImport = {
          id: newId('imp'), teamId, seasonId, filename: file.name, status: 'previewed',
          mapping: Object.fromEntries(header.map((h) => [h, h])), rowCount: rows.length, errors, createdAt: nowIso(), previewRows: rows,
        };
        db.imports.push(record);
        return delay(record);
      },
      async applyImport(importId) {
        const record = db.imports.find((i) => i.id === importId);
        if (!record) fail('not_found', 'Import not found.', 404);
        requireTeam(record.teamId);
        if (record.status !== 'previewed') fail('conflict', 'This import was already applied or discarded.', 409);
        if (record.errors.length) fail('validation_error', 'Fix the listed rows before applying.', 400, { issues: record.errors });
        const ts = nowIso();
        const created = (record.previewRows ?? []).map((row): ScheduledGame => {
          let opponentId: string | null = null;
          if (row.opponentName) {
            const existing = db.opponents.find((o) => o.shortName.toLowerCase() === row.opponentName!.toLowerCase());
            if (existing) opponentId = existing.id;
            else {
              const opp = { id: newId('opp'), teamId: record.teamId, name: `${row.opponentName} (demo)`, shortName: row.opponentName, notes: 'Created by schedule import.' };
              db.opponents.push(opp);
              opponentId = opp.id;
            }
          }
          return {
            id: newId('game'), teamId: record.teamId, seasonId: record.seasonId, week: row.week ?? null, kind: row.kind ?? 'regular', opponentId,
            location: row.location ?? null, scheduledAt: row.scheduledAt ?? null, status: 'scheduled', result: null, notes: `Imported from ${record.filename}`,
            version: 1, createdAt: ts, updatedAt: ts,
          };
        });
        db.games.push(...created);
        record.status = 'applied';
        return delay(created);
      },
    },
    media: {
      async assets(gameId) {
        gameOrFail(gameId);
        return delay(db.assets.filter((a) => a.gameId === gameId));
      },
      async createUpload(gameId, input) {
        const game = gameOrFail(gameId);
        const { memberships } = requireUser();
        if (!memberships.some((m) => m.role !== 'viewer')) fail('forbidden', 'Viewers cannot upload film.', 403);
        if (!input.mimeType.startsWith('video/')) fail('validation_error', 'Choose a video file (MP4 or MOV).', 400);
        if (input.byteSize > 8 * 1024 ** 3) fail('payload_too_large', 'Files above 8 GB are not accepted.', 413);
        const duplicate = db.assets.find((a) => a.gameId === gameId && a.originalFilename === input.filename && a.byteSize === input.byteSize);
        if (duplicate) fail('conflict', 'This file was already uploaded for this game.', 409, { existingAssetId: duplicate.id });
        const ts = nowIso();
        const asset: MediaAsset = {
          id: newId('asset'), teamId: game.teamId, gameId, uploadedBy: session!.userId, kind: 'game_film', originalFilename: input.filename,
          byteSize: input.byteSize, sha256: 'pending', mimeType: input.mimeType, durationSec: null, width: null, height: null, fps: null,
          status: 'uploading', rejectionReason: null, context: input.context, quality: null, storageKey: `demo/${gameId}/${input.filename}`,
          proxyStorageKey: null, thumbnailSheetKey: null, retentionUntil: null, createdAt: ts, updatedAt: ts,
        };
        db.assets.unshift(asset);
        const job: ProcessingJob = {
          id: newId('job'), teamId: game.teamId, assetId: asset.id, kind: 'validate', status: 'queued',
          progress: { done: 0, total: null, message: 'Waiting for the upload to finish' }, attempt: 0, maxAttempts: 3, leaseExpiresAt: null,
          workerId: null, idempotencyKey: newId('idem'), configVersion: 'media-0.1', error: null, requestedBy: session!.userId, createdAt: ts,
          startedAt: null, finishedAt: null, canceledAt: null,
        };
        db.jobs.unshift(job);
        return delay(asset);
      },
      async jobs(teamId) {
        requireTeam(teamId);
        return delay(db.jobs);
      },
      async segments(assetId) {
        const asset = db.assets.find((a) => a.id === assetId);
        if (!asset) fail('not_found', 'Asset not found.', 404);
        requireTeam(asset.teamId);
        return delay(db.segments.filter((s) => s.assetId === assetId));
      },
    },
    scouting: {
      async findings(teamId, opponentId, unit) {
        requireTeam(teamId);
        if (!db.opponents.some((o) => o.id === opponentId)) fail('not_found', 'Opponent not found.', 404);
        return delay(db.findings.filter((f) => f.opponentId === opponentId && f.unit === unit));
      },
    },
    plans: {
      async get(gameId, unit): Promise<GamePlanBundle> {
        const game = gameOrFail(gameId);
        let plan = db.plans.find((p) => p.gameId === gameId && p.unit === unit);
        if (!plan) {
          // A plan exists for every game and unit; the first read creates an empty draft.
          const ts = nowIso();
          const versionId = newId('pv');
          plan = { id: newId('plan'), teamId: game.teamId, gameId, unit, currentVersionId: versionId, createdAt: ts };
          db.plans.push(plan);
          db.planVersions.push({
            id: versionId, planId: plan.id, number: 1, status: 'draft', basedOn: null, createdBy: session!.userId, createdAt: ts, approvedBy: null,
            approvedAt: null, override: false, version: 1,
            sections: PLAN_SECTION_TEMPLATES[unit].map((t) => ({ key: t.key, title: t.title, items: [] })),
          });
        }
        const versions = db.planVersions.filter((v) => v.planId === plan!.id).sort((a, b) => a.number - b.number);
        const comments = db.planComments.filter((c) => versions.some((v) => v.id === c.versionId));
        return delay({ plan, versions, comments });
      },
      async createDraft(versionId) {
        const base = versionOrFail(versionId);
        const plan = db.plans.find((p) => p.id === base.planId)!;
        if (!canEditUnit(plan.unit)) fail('forbidden', 'You cannot edit this unit’s plan.', 403);
        if (base.status !== 'approved') fail('conflict', 'Only an approved version can be the base of a new draft.', 409);
        const ts = nowIso();
        const draft: GamePlanVersion = {
          ...clone(base), id: newId('pv'), number: Math.max(...db.planVersions.filter((v) => v.planId === plan.id).map((v) => v.number)) + 1,
          status: 'draft', basedOn: base.id, createdBy: session!.userId, createdAt: ts, approvedBy: null, approvedAt: null, override: false, version: 1,
        };
        db.planVersions.push(draft);
        plan.currentVersionId = draft.id;
        return delay(draft);
      },
      async update(versionId, patch) {
        const version = versionOrFail(versionId);
        const plan = db.plans.find((p) => p.id === version.planId)!;
        if (!canEditUnit(plan.unit)) fail('forbidden', 'You cannot edit this unit’s plan.', 403);
        if (version.status === 'approved' || version.status === 'superseded') fail('conflict', 'Approved versions are immutable. Start a new draft from it.', 409);
        checkVersion(version.version, patch.expectedVersion, 'Plan');
        version.sections = patch.sections;
        version.version += 1;
        return delay(version);
      },
      async submit(versionId) {
        const version = versionOrFail(versionId);
        if (version.status !== 'draft') fail('conflict', 'Only a draft can be submitted for review.', 409);
        version.status = 'in_review';
        version.version += 1;
        return delay(version);
      },
      async approve(versionId) {
        const version = versionOrFail(versionId);
        const plan = db.plans.find((p) => p.id === version.planId)!;
        const { memberships } = requireUser();
        const head = memberships.find((m) => m.role === 'head_coach');
        const coordinator = memberships.find((m) => m.role === 'coordinator' && m.units.includes(plan.unit));
        if (!head && !coordinator) fail('forbidden', 'Only the unit coordinator or the head coach can approve.', 403);
        if (version.status !== 'in_review' && version.status !== 'draft') fail('conflict', 'This version cannot be approved from its current state.', 409);
        for (const other of db.planVersions) if (other.planId === plan.id && other.status === 'approved') other.status = 'superseded';
        version.status = 'approved';
        version.approvedBy = session!.userId;
        version.approvedAt = nowIso();
        version.override = !coordinator && !!head;
        version.version += 1;
        plan.currentVersionId = version.id;
        return delay(version);
      },
      async comment(versionId, input) {
        versionOrFail(versionId);
        if (!input.body.trim()) fail('validation_error', 'Write a comment first.', 400);
        const comment: PlanComment = { id: newId('pc'), versionId, sectionKey: input.sectionKey, itemId: input.itemId, authorUserId: session!.userId, body: input.body.trim(), createdAt: nowIso(), resolvedAt: null };
        db.planComments.push(comment);
        return delay(comment);
      },
    },
    playbook: {
      async documents(teamId, unit) {
        requireTeam(teamId);
        return delay(db.playbookDocuments.filter((d) => d.unit === unit));
      },
      async versions(teamId, unit) {
        requireTeam(teamId);
        return delay(db.playbookVersions.filter((v) => v.unit === unit));
      },
      async concepts(versionId) {
        const version = db.playbookVersions.find((v) => v.id === versionId);
        if (!version) fail('not_found', 'Playbook version not found.', 404);
        requireTeam(version.teamId);
        return delay(db.concepts.filter((c) => c.versionId === versionId));
      },
      async decideConcept(conceptId, input) {
        const concept = db.concepts.find((c) => c.id === conceptId);
        if (!concept) fail('not_found', 'Concept not found.', 404);
        requireTeam(concept.teamId);
        const version = db.playbookVersions.find((v) => v.id === concept.versionId)!;
        const { memberships } = requireUser();
        if (!memberships.some((m) => m.role === 'head_coach' || (m.role === 'coordinator' && m.units.includes(version.unit)))) {
          fail('forbidden', 'Only the head coach or the unit coordinator can approve extracted concepts.', 403);
        }
        checkVersion(concept.version, input.expectedVersion, 'Concept');
        const next: Concept = { ...concept, status: input.status, installed: input.status === 'approved' ? concept.installed : false, version: concept.version + 1 };
        Object.assign(concept, next);
        return delay(concept);
      },
    },
    personnel: {
      async players(teamId, seasonId) {
        requireTeam(teamId);
        return delay(db.players.filter((p) => p.seasonId === seasonId));
      },
      async depthChart(teamId, seasonId, unit) {
        requireTeam(teamId);
        return delay(db.depthCharts.find((d) => d.seasonId === seasonId && d.unit === unit) ?? null);
      },
      async packages(teamId, seasonId, unit) {
        requireTeam(teamId);
        return delay(db.packages.filter((p) => p.seasonId === seasonId && p.unit === unit));
      },
    },
  };

  return api;
}
