/**
 * TEST-ONLY in-memory implementation of `Api`, served from the fictional Winchester Hawks
 * records in `./data.ts`. It exists so the product shell's tests can drive every screen
 * without `apps/api`; it is never bundled into the app. Mutations live in memory for the life
 * of one instance; a "simulated worker" advances jobs one step per poll so polling can be
 * tested. `infer_labels` always fails truthfully: this fake has no model and never invents a
 * label.
 */
import type { Api, GamePlanBundle, Me, SignInResult, TeamSettings } from '../../api/api';
import { ApiError } from '../../api/api';
import type {
  Concept,
  GamePlanVersion,
  Invite,
  Label,
  LabelRevision,
  MediaAsset,
  PlanComment,
  PlanSectionKey,
  PlaySegment,
  ProcessingJob,
  ReportSnapshot,
  ScheduleImport,
  ScheduledGame,
  StaffMembership,
  Unit,
  Upload,
  User,
} from '../../api/contracts';
import { PLAN_SECTION_TEMPLATES } from '../../api/contracts';
import * as demo from './data';
import { DEMO_LABEL_KEYS, DEMO_MFA_CODE, DEMO_NOW } from './data';

export { DEMO_MFA_CODE, DEMO_NOW };

/** The fake grant names one of six short stand-in clips; nothing is served, the URL is only a string the player receives. */
const DEMO_CLIP_COUNT = 6;
/** Length of each stand-in clip (`fixtures/media/clips/play-N.mp4`), so the player knows the playable range. */
const DEMO_CLIP_DURATIONS = [6.374, 7.408, 6.407, 5.406, 7.908, 7.408];

/**
 * Thumbnail tiles: an SVG data URL that keeps the `{n}` placeholder, so the
 * client's template substitution produces a tile that names its own index. Nothing is
 * pretending to be a frame of the film.
 */
const DEMO_THUMB_TEMPLATE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" fill="#151d27"/><rect x="0.5" y="0.5" width="159" height="89" fill="none" stroke="#34455a"/><text x="80" y="40" fill="#aab6c4" font-family="ui-monospace, monospace" font-size="11" text-anchor="middle">demo tile</text><text x="80" y="62" fill="#e2b457" font-family="ui-monospace, monospace" font-size="16" text-anchor="middle">#TILE#</text></svg>',
).replace('%23TILE%23', '{n}')}`;

/** Simulated worker: how many polls a fake job takes from `running` to done. */
const SIMULATED_STEPS = 2;

export interface FakeApiOptions {
  latencyMs?: number;
  /** Start signed in as this fictional user. */
  signedInAs?: string;
}

interface FakeSession {
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

/** Fresh copies of the seed per instance so one test's mutations never reach another. */
function seedDb() {
  return {
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
    labels: clone(demo.labels),
    provenance: clone(demo.provenance),
    labelRevisions: clone(demo.labelRevisions),
    snapshots: clone(demo.snapshots),
    imports: [] as ScheduleImport[],
    uploads: [] as Upload[],
  };
}
type FakeDb = ReturnType<typeof seedDb>;

export function createFakeApi(options: FakeApiOptions = {}): Api {
  const latency = options.latencyMs ?? 0;

  const db: FakeDb = seedDb();
  /** Jobs created in this instance whose progress the fake worker simulates on every poll. */
  const simulated = new Set<string>();
  const uploadSha = new Map<string, string | undefined>();

  let session: FakeSession | null = options.signedInAs ? { userId: options.signedInAs, mfaVerified: true } : null;
  let pendingMfaUser: string | null = null;

  function writeSession(next: FakeSession | null) {
    session = next;
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

  /** Upload film and correct labels: every role except viewer (CONTRACTS §3). */
  function requireLabeler() {
    const { user, memberships } = requireUser();
    if (!memberships.some((m) => m.role !== 'viewer')) fail('forbidden', 'Viewers cannot upload film or change labels.', 403);
    return user;
  }

  function assetOrFail(assetId: string): MediaAsset {
    const asset = db.assets.find((a) => a.id === assetId && a.status !== 'deleted');
    if (!asset) fail('not_found', 'Asset not found.', 404);
    requireTeam(asset.teamId);
    return asset;
  }

  function segmentOrFail(segmentId: string): PlaySegment {
    const segment = db.segments.find((s) => s.id === segmentId);
    if (!segment) fail('not_found', 'Segment not found.', 404);
    requireTeam(segment.teamId);
    if (segment.supersededBy.length) fail('conflict', 'This segment was split or merged; reload the timeline.', 409, { supersededBy: segment.supersededBy });
    return segment;
  }

  function labelOrFail(labelId: string): Label {
    const label = db.labels.find((l) => l.id === labelId);
    if (!label) fail('not_found', 'Label not found.', 404);
    requireTeam(label.teamId);
    return label;
  }

  /** Live (non-superseded) segments of an asset, ordered and re-indexed by start time. */
  function liveSegments(assetId: string): PlaySegment[] {
    const live = db.segments.filter((s) => s.assetId === assetId && s.supersededBy.length === 0).sort((a, b) => a.startSec - b.startSec);
    live.forEach((s, i) => {
      s.index = i + 1;
    });
    return live;
  }

  function newSegment(base: Pick<PlaySegment, 'teamId' | 'assetId' | 'gameId'>, startSec: number, endSec: number, origin: PlaySegment['origin'], reviewStatus: PlaySegment['reviewStatus']): PlaySegment {
    const ts = nowIso();
    const segment: PlaySegment = { id: newId('seg'), teamId: base.teamId, assetId: base.assetId, gameId: base.gameId, index: 0, startSec, endSec, origin, reviewStatus, supersededBy: [], version: 1, createdAt: ts, updatedAt: ts };
    db.segments.push(segment);
    // A new segment gets empty label rows so a coach can label it by hand (status `unknown`).
    for (const key of DEMO_LABEL_KEYS) {
      db.labels.push({ id: newId('label'), teamId: base.teamId, segmentId: segment.id, key, inferred: null, accepted: { value: null, status: 'unknown', byUserId: null, at: null }, provenanceId: null, version: 1, createdAt: ts, updatedAt: ts });
    }
    return segment;
  }

  function newJob(asset: MediaAsset, kind: ProcessingJob['kind'], message: string, configVersion: string): ProcessingJob {
    const ts = nowIso();
    const job: ProcessingJob = {
      id: newId('job'), teamId: asset.teamId, assetId: asset.id, kind, status: 'queued', progress: { done: 0, total: null, message }, attempt: 0, maxAttempts: 3,
      leaseExpiresAt: null, workerId: null, idempotencyKey: newId('idem'), configVersion, error: null, requestedBy: session!.userId, createdAt: ts, startedAt: null, finishedAt: null, canceledAt: null,
    };
    db.jobs.unshift(job);
    simulated.add(job.id);
    return job;
  }

  /**
   * The fake worker. Called on every job read: advances the oldest queued/running simulated
   * job of each asset one step, so polling shows a chain complete in order. `infer_labels`
   * fails truthfully: the fake has no model provider and never invents a label.
   */
  function advanceJobs() {
    const byAsset = new Map<string, ProcessingJob[]>();
    for (const job of [...db.jobs].reverse()) {
      if (!simulated.has(job.id) || !job.assetId) continue;
      if (job.status !== 'queued' && job.status !== 'running') continue;
      const list = byAsset.get(job.assetId) ?? [];
      list.push(job);
      byAsset.set(job.assetId, list);
    }
    for (const [assetId, chain] of byAsset) {
      const job = chain[0];
      const asset = db.assets.find((a) => a.id === assetId);
      // Documents (`gameId: null`, §15.1) never carry film jobs; only game film is simulated.
      if (!asset || !asset.gameId) continue;
      const ts = nowIso();
      if (job.status === 'queued') {
        Object.assign(job, { status: 'running', attempt: 1, startedAt: ts, workerId: 'worker-demo', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), progress: { done: 0, total: SIMULATED_STEPS, message: `${humanKind(job.kind)} started` } });
        if (job.kind !== 'infer_labels' && asset.status !== 'ready') asset.status = 'processing';
        continue;
      }
      job.progress = { ...job.progress, done: job.progress.done + 1 };
      if (job.kind === 'infer_labels') {
        Object.assign(job, { status: 'failed', finishedAt: ts, leaseExpiresAt: null, progress: { done: 0, total: job.progress.total, message: 'Stopped before any segment was labeled' }, error: { code: 'provider_unavailable', message: 'No model provider is configured for this team. Labels can be entered by a coach.' } });
        continue;
      }
      if (job.progress.done < SIMULATED_STEPS) {
        job.progress.message = `${humanKind(job.kind)} ${job.progress.done} of ${SIMULATED_STEPS}`;
        continue;
      }
      Object.assign(job, { status: 'succeeded', finishedAt: ts, leaseExpiresAt: null, progress: { done: SIMULATED_STEPS, total: SIMULATED_STEPS, message: 'Done' } });
      asset.updatedAt = ts;
      if (job.kind === 'validate') {
        // Demo probe: values are simulated and say so; a real validate job reads them with ffprobe.
        Object.assign(asset, { status: 'validated', durationSec: Math.max(30, Math.round(asset.byteSize / 400_000)), width: 1280, height: 720, fps: 29.97, quality: { stable: null, lineOfScrimmageVisible: null, allTwentyTwoVisible: null, notes: ['Demo validation: the stream was not probed; duration is estimated from file size.'], unevaluable: ['Camera stability', 'Line of scrimmage', 'All 22 players'] } });
      } else if (job.kind === 'proxy') asset.proxyStorageKey = `demo/${asset.id}/proxy`;
      else if (job.kind === 'thumbnails') asset.thumbnailSheetKey = `demo/${asset.id}/thumbs`;
      else if (job.kind === 'segment') {
        const duration = asset.durationSec ?? 60;
        const count = Math.min(6, Math.max(1, Math.floor(duration / 10)));
        for (let i = 0; i < count; i += 1) {
          const start = Math.round(((i + 0.5) * duration) / count - 3);
          newSegment({ teamId: asset.teamId, assetId: asset.id, gameId: asset.gameId }, Math.max(0, start), Math.min(duration, start + 7), 'proposed', 'proposed');
        }
        liveSegments(asset.id);
        job.progress.message = `${count} play boundaries proposed (demo heuristic)`;
        asset.status = 'ready';
      }
    }
  }

  function humanKind(kind: string): string {
    return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  function writeRevision(label: Label, next: Label['accepted'], reason: string | null, byUserId: string): LabelRevision {
    const revision: LabelRevision = { id: newId('rev'), labelId: label.id, previousValue: label.accepted.value, newValue: next.value, previousStatus: label.accepted.status, newStatus: next.status, byUserId, at: next.at ?? nowIso(), reason };
    db.labelRevisions.push(revision);
    return revision;
  }

  const api: Api = {
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
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), acceptedAt: null, createdBy: actor.userId, createdAt: nowIso(),
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
        if (rest.retentionDays !== undefined && rest.retentionDays !== null && (!Number.isInteger(rest.retentionDays) || rest.retentionDays < 30)) {
          fail('validation_error', 'Retention must be blank (keep until deleted) or at least 30 days.', 400);
        }
        const next: TeamSettings = { ...db.settings, ...rest, version: db.settings.version + 1 };
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
        const rows: ScheduleImport['rows'] = [];
        lines.slice(1).forEach((line, i) => {
          const cells = line.split(',').map((c) => c.trim());
          const week = col('week') >= 0 ? Number(cells[col('week')]) : NaN;
          const opponentName = col('opponent') >= 0 ? cells[col('opponent')] || null : null;
          const locationRaw = col('location') >= 0 ? cells[col('location')].toLowerCase() : '';
          const location = locationRaw === 'home' || locationRaw === 'away' || locationRaw === 'neutral' ? locationRaw : null;
          const dateRaw = col('date') >= 0 ? cells[col('date')] : '';
          const scheduledAt = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : null;
          if (dateRaw && !scheduledAt) errors.push({ row: i + 1, column: 'date', message: `Date "${dateRaw}" could not be read.` });
          if (!opponentName && locationRaw !== 'bye') errors.push({ row: i + 1, column: 'opponent', message: 'No opponent and not marked as a bye.' });
          rows.push({ row: i + 1, week: Number.isNaN(week) ? null : week, kind: locationRaw === 'bye' || !opponentName ? 'bye' : 'regular', location, scheduledAt, opponentName, notes: '' });
        });
        const record: ScheduleImport = {
          id: newId('imp'), teamId, seasonId, filename: file.name, status: 'previewed',
          mapping: Object.fromEntries(header.map((h) => [h, (['week', 'date', 'time', 'opponent', 'location', 'kind', 'notes'] as const).find((f) => f === h) ?? 'ignore'])),
          rowCount: rows.length, errors, createdAt: nowIso(), rows,
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
        const created = record.rows.map((row): ScheduledGame => {
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
        return delay(db.assets.filter((a) => a.gameId === gameId && a.status !== 'deleted'));
      },
      async asset(assetId) {
        return delay(assetOrFail(assetId));
      },
      async createUpload(gameId, input) {
        const game = gameOrFail(gameId);
        const user = requireLabeler();
        const ext = input.filename.toLowerCase().split('.').pop() ?? '';
        if (!input.mimeType.startsWith('video/') || !db.settings.uploadLimits.allowedVideoContainers.includes(ext)) {
          fail('validation_error', `Choose a video file (${db.settings.uploadLimits.allowedVideoContainers.map((c) => c.toUpperCase()).join(' or ')}).`, 400);
        }
        if (input.byteSize > db.settings.uploadLimits.maxUploadBytes) fail('payload_too_large', `Files above ${Math.round(db.settings.uploadLimits.maxUploadBytes / 1024 ** 3)} GB are not accepted.`, 413);
        if (input.sha256) {
          const duplicate = db.assets.find((a) => a.teamId === game.teamId && a.sha256 === input.sha256 && a.status !== 'deleted');
          if (duplicate) fail('conflict', 'This exact file is already in the team library.', 409, { existingAssetId: duplicate.id });
        }
        const ts = nowIso();
        const asset: MediaAsset = {
          id: newId('asset'), teamId: game.teamId, gameId, uploadedBy: user.id, kind: 'game_film', originalFilename: input.filename,
          byteSize: input.byteSize, sha256: input.sha256 ?? 'pending', mimeType: input.mimeType, durationSec: null, width: null, height: null, fps: null,
          status: 'uploading', rejectionReason: null, context: input.context, quality: null, storageKey: `demo/${gameId}/${input.filename}`,
          proxyStorageKey: null, thumbnailSheetKey: null, retentionUntil: null, createdAt: ts, updatedAt: ts,
        };
        db.assets.unshift(asset);
        const upload: Upload = {
          id: newId('upload'), assetId: asset.id, teamId: game.teamId, chunkSizeBytes: db.settings.uploadLimits.uploadChunkBytes, receivedBytes: 0, totalBytes: input.byteSize,
          expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), completedAt: null,
        };
        db.uploads.push(upload);
        uploadSha.set(upload.id, input.sha256);
        return delay({ upload, asset });
      },
      async putChunk(uploadId, range, body) {
        requireLabeler();
        const upload = db.uploads.find((u) => u.id === uploadId);
        if (!upload) fail('not_found', 'Upload not found or expired.', 404);
        if (upload.completedAt) fail('conflict', 'This upload is already complete.', 409);
        if (range.total !== upload.totalBytes) fail('validation_error', 'Content-Range total does not match the upload.', 400);
        if (range.end - range.start + 1 > upload.chunkSizeBytes) fail('payload_too_large', `Chunks may be at most ${upload.chunkSizeBytes} bytes.`, 413);
        if (range.end - range.start + 1 !== body.size) fail('validation_error', 'Body length does not match Content-Range.', 400);
        if (range.start !== upload.receivedBytes) fail('conflict', 'Chunks must be contiguous.', 409, { receivedBytes: upload.receivedBytes });
        upload.receivedBytes = range.end + 1;
        return delay({ receivedBytes: upload.receivedBytes });
      },
      async getUpload(uploadId) {
        requireUser();
        const upload = db.uploads.find((u) => u.id === uploadId);
        if (!upload) fail('not_found', 'Upload not found or expired.', 404);
        return delay(upload);
      },
      async completeUpload(uploadId) {
        requireLabeler();
        const upload = db.uploads.find((u) => u.id === uploadId);
        if (!upload) fail('not_found', 'Upload not found or expired.', 404);
        if (upload.receivedBytes !== upload.totalBytes) fail('conflict', `Only ${upload.receivedBytes} of ${upload.totalBytes} bytes were received.`, 409, { receivedBytes: upload.receivedBytes });
        const asset = db.assets.find((a) => a.id === upload.assetId)!;
        const ts = nowIso();
        upload.completedAt = ts;
        // The server would hash the stored file here; the fake keeps the client hash or a demo marker.
        asset.sha256 = uploadSha.get(uploadId) ?? `demo-sha-${asset.id}`;
        asset.status = 'uploaded';
        asset.updatedAt = ts;
        const jobs = [
          newJob(asset, 'validate', 'Waiting for a worker', 'media-0.1'),
          newJob(asset, 'proxy', 'Waiting for validation', 'media-0.1'),
          newJob(asset, 'thumbnails', 'Waiting for the proxy', 'media-0.1'),
          newJob(asset, 'segment', 'Waiting for thumbnails', 'media-0.1'),
        ];
        return delay({ asset, jobs });
      },
      async deleteAsset(assetId) {
        const asset = assetOrFail(assetId);
        requireHeadCoach(asset.teamId);
        asset.status = 'deleted';
        asset.updatedAt = nowIso();
        return delay(undefined);
      },
      async grant(assetId) {
        const asset = assetOrFail(assetId);
        if (asset.status !== 'ready' && asset.status !== 'processing' && asset.status !== 'validated') fail('conflict', 'No playable file for this asset yet.', 409);
        const clip = (db.assets.filter((a) => a.status !== 'deleted').findIndex((a) => a.id === assetId) % DEMO_CLIP_COUNT) + 1;
        const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
        return delay({
          streamUrl: `${base.replace(/\/$/, '')}/media/fake/play-${clip}.mp4?grant=${newId('tok')}`,
          thumbUrlTemplate: DEMO_THUMB_TEMPLATE,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          thumbEverySec: 10,
          thumbCount: Math.ceil((asset.durationSec ?? 0) / 10),
          proxy: { standIn: true, durationSec: DEMO_CLIP_DURATIONS[clip - 1], note: 'Credited demo clip (SWOSU vs UCO, CC BY-NC 4.0) standing in for the proxy; it is not footage of this game.' },
        });
      },
      async jobs(teamId, query = {}) {
        requireTeam(teamId);
        advanceJobs();
        return delay(db.jobs.filter((j) => j.teamId === teamId && (!query.assetId || j.assetId === query.assetId) && (!query.status || j.status === query.status)));
      },
      async job(jobId) {
        const job = db.jobs.find((j) => j.id === jobId);
        if (!job) fail('not_found', 'Job not found.', 404);
        requireTeam(job.teamId);
        advanceJobs();
        return delay(job);
      },
      async cancelJob(jobId) {
        const job = db.jobs.find((j) => j.id === jobId);
        if (!job) fail('not_found', 'Job not found.', 404);
        requireTeam(job.teamId);
        if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'retry_wait') fail('conflict', `A ${job.status} job cannot be canceled.`, 409);
        const ts = nowIso();
        Object.assign(job, { status: 'canceled', canceledAt: ts, finishedAt: ts, leaseExpiresAt: null, progress: { ...job.progress, message: 'Canceled by a coach' } });
        return delay(job);
      },
      async retryJob(jobId) {
        const job = db.jobs.find((j) => j.id === jobId);
        if (!job) fail('not_found', 'Job not found.', 404);
        requireTeam(job.teamId);
        if (job.status !== 'failed' && job.status !== 'canceled') fail('conflict', `Only failed or canceled jobs can be retried (this one is ${job.status}).`, 409);
        Object.assign(job, { status: 'queued', attempt: 0, error: null, startedAt: null, finishedAt: null, canceledAt: null, progress: { done: 0, total: null, message: 'Queued again' } });
        simulated.add(job.id);
        return delay(job);
      },
      async segments(assetId) {
        assetOrFail(assetId);
        return delay(liveSegments(assetId));
      },
      async splitSegment(segmentId, input) {
        requireLabeler();
        const original = segmentOrFail(segmentId);
        checkVersion(original.version, input.expectedVersion, 'Segment');
        if (!(input.atSec > original.startSec + 0.5 && input.atSec < original.endSec - 0.5)) fail('validation_error', 'Split point must be at least half a second inside the play.', 400);
        const a = newSegment(original, original.startSec, input.atSec, 'coach_split', original.reviewStatus);
        const b = newSegment(original, input.atSec, original.endSec, 'coach_split', original.reviewStatus);
        original.supersededBy = [a.id, b.id];
        original.version += 1;
        original.updatedAt = nowIso();
        liveSegments(original.assetId);
        return delay({ segments: [a, b], superseded: original });
      },
      async mergeSegments(input) {
        requireLabeler();
        if (input.segmentIds.length < 2) fail('validation_error', 'Choose at least two adjacent plays to merge.', 400);
        const parts = input.segmentIds.map((id) => segmentOrFail(id)).sort((x, y) => x.startSec - y.startSec);
        for (const part of parts) checkVersion(part.version, input.expectedVersion[part.id] ?? -1, `Segment ${part.index}`);
        const live = liveSegments(parts[0].assetId);
        const first = live.findIndex((s) => s.id === parts[0].id);
        for (let i = 1; i < parts.length; i += 1) if (live[first + i]?.id !== parts[i].id) fail('validation_error', 'Only adjacent plays can be merged.', 400);
        const merged = newSegment(parts[0], parts[0].startSec, parts[parts.length - 1].endSec, 'coach_merged', parts.every((p) => p.reviewStatus === 'accepted') ? 'accepted' : 'proposed');
        const ts = nowIso();
        for (const part of parts) {
          part.supersededBy = [merged.id];
          part.version += 1;
          part.updatedAt = ts;
        }
        liveSegments(merged.assetId);
        return delay({ segment: merged, superseded: parts });
      },
      async updateSegment(segmentId, patch) {
        requireLabeler();
        const segment = segmentOrFail(segmentId);
        checkVersion(segment.version, patch.expectedVersion, 'Segment');
        const { expectedVersion: _expected, ...rest } = patch;
        const startSec = rest.startSec ?? segment.startSec;
        const endSec = rest.endSec ?? segment.endSec;
        if (endSec <= startSec) fail('validation_error', 'A play must end after it starts.', 400);
        Object.assign(segment, rest, { version: segment.version + 1, updatedAt: nowIso() });
        liveSegments(segment.assetId);
        return delay(segment);
      },
      async createSegment(assetId, input) {
        requireLabeler();
        const asset = assetOrFail(assetId);
        if (!asset.gameId) fail('conflict', 'Only game film has plays; this asset is a document.', 409);
        if (input.endSec <= input.startSec) fail('validation_error', 'A play must end after it starts.', 400);
        const segment = newSegment({ teamId: asset.teamId, assetId: asset.id, gameId: asset.gameId }, input.startSec, input.endSec, 'coach_created', 'accepted');
        liveSegments(assetId);
        return delay(segment);
      },
    },
    labels: {
      async forAsset(assetId) {
        assetOrFail(assetId);
        const live = new Set(liveSegments(assetId).map((s) => s.id));
        return delay(db.labels.filter((l) => live.has(l.segmentId)));
      },
      async forSegment(segmentId) {
        const segment = db.segments.find((s) => s.id === segmentId);
        if (!segment) fail('not_found', 'Segment not found.', 404);
        requireTeam(segment.teamId);
        return delay(db.labels.filter((l) => l.segmentId === segmentId));
      },
      async correct(labelId, input) {
        const user = requireLabeler();
        const label = labelOrFail(labelId);
        checkVersion(label.version, input.expectedVersion, 'Label');
        if (input.accepted.status === 'accepted' && !label.inferred) fail('validation_error', 'There is no inferred value to accept; enter a value as a correction instead.', 400);
        if (input.accepted.status === 'accepted' && label.inferred?.abstained) fail('validation_error', 'The model abstained on this label; there is no value to accept.', 400);
        const next: Label['accepted'] = {
          value: input.accepted.status === 'accepted' ? (label.inferred?.value ?? null) : input.accepted.status === 'corrected' ? input.accepted.value : null,
          status: input.accepted.status, byUserId: user.id, at: nowIso(),
        };
        if (next.status === 'corrected' && (next.value === null || next.value.trim() === '')) fail('validation_error', 'A correction needs a value; use "unknown" when it cannot be established.', 400);
        writeRevision(label, next, input.reason?.trim() || null, user.id);
        label.accepted = next;
        label.version += 1;
        label.updatedAt = next.at!;
        return delay(label);
      },
      async revisions(labelId) {
        labelOrFail(labelId);
        return delay(db.labelRevisions.filter((r) => r.labelId === labelId).sort((a, b) => a.at.localeCompare(b.at)));
      },
      async bulkAccept(assetId, input) {
        const user = requireLabeler();
        assetOrFail(assetId);
        const segmentIds = new Set(input.segmentIds);
        const keys = new Set(input.keys);
        let accepted = 0;
        let skipped = 0;
        const at = nowIso();
        for (const label of db.labels) {
          if (!segmentIds.has(label.segmentId) || !keys.has(label.key)) continue;
          // §14.5: only the model's own proposals, and never an abstention.
          if (label.accepted.status === 'inferred' && label.inferred && !label.inferred.abstained) {
            const next: Label['accepted'] = { value: label.inferred.value, status: 'accepted', byUserId: user.id, at };
            writeRevision(label, next, 'Bulk accept', user.id);
            label.accepted = next;
            label.version += 1;
            label.updatedAt = at;
            accepted += 1;
          } else skipped += 1;
        }
        return delay({ accepted, skipped });
      },
      async provenance(assetId) {
        assetOrFail(assetId);
        const ids = new Set(db.labels.filter((l) => db.segments.some((s) => s.id === l.segmentId && s.assetId === assetId)).map((l) => l.provenanceId));
        return delay(db.provenance.filter((p) => ids.has(p.id)));
      },
      async infer(assetId, input = {}) {
        requireLabeler();
        const asset = assetOrFail(assetId);
        if (asset.status !== 'ready') fail('conflict', 'Inference needs a processed asset with proposed plays.', 409);
        const wanted = input.segmentIds?.length ? input.segmentIds.length : liveSegments(assetId).length;
        const job = newJob(asset, 'infer_labels', `Queued for ${wanted} segment${wanted === 1 ? '' : 's'}`, 'ai-0.1');
        return delay([job]);
      },
    },
    scouting: {
      async report(teamId, opponentId, query) {
        requireTeam(teamId);
        if (!db.opponents.some((o) => o.id === opponentId)) fail('not_found', 'Opponent not found.', 404);
        // The fake keeps precomputed demo findings; the API recomputes from stored labels.
        // `reviewed_only` drops every finding that needed unreviewed labels.
        const findings = db.findings.filter((f) => f.opponentId === opponentId && f.unit === query.unit && (query.reviewBasis === 'includes_inferred' || f.reviewBasis === 'reviewed_only'));
        const gameIds = new Set(findings.flatMap((f) => f.gameIds));
        const games = db.games
          .filter((g) => g.opponentId === opponentId && (gameIds.size === 0 || gameIds.has(g.id)))
          .map((g) => ({ gameId: g.id, assetIds: db.assets.filter((a) => a.gameId === g.id && a.context.analyzedTeam === 'opponent' && a.status === 'ready').map((a) => a.id) }));
        return delay({ findings, games, sampleSize: Math.max(0, ...findings.map((f) => f.sampleSize)), computedAt: nowIso(), computeVersion: 'stats-0.1' });
      },
      async snapshots(teamId, opponentId) {
        requireTeam(teamId);
        return delay(db.snapshots.filter((s) => s.opponentId === opponentId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)));
      },
      async saveSnapshot(teamId, opponentId, input) {
        requireTeam(teamId);
        if (!input.title.trim()) fail('validation_error', 'Give the snapshot a title.', 400);
        const findings = db.findings.filter((f) => f.opponentId === opponentId && f.unit === input.unit && (input.reviewBasis === 'includes_inferred' || f.reviewBasis === 'reviewed_only'));
        const snapshot: ReportSnapshot = { id: newId('snap'), teamId, opponentId, title: input.title.trim(), findings: clone(findings), generatedBy: session!.userId, generatedAt: nowIso(), inputsHash: newId('sha256:demo') };
        db.snapshots.push(snapshot);
        return delay(snapshot);
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
            approvedAt: null, override: false, overrideReason: null, supersededAt: null, supersededByVersionId: null, version: 1,
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
        // §15.4 / D-014: at most one draft per plan (HC-07). The existing draft is named so the UI can open it.
        const open = db.planVersions.find((v) => v.planId === plan.id && v.status === 'draft');
        if (open) fail('conflict', `This unit already has an open draft (v${open.number}); edit that one instead of starting another.`, 409, { reason: 'draft_exists', versionId: open.id, currentStatus: open.status });
        const ts = nowIso();
        const draft: GamePlanVersion = {
          ...clone(base), id: newId('pv'), number: Math.max(...db.planVersions.filter((v) => v.planId === plan.id).map((v) => v.number)) + 1,
          status: 'draft', basedOn: base.id, createdBy: session!.userId, createdAt: ts, approvedBy: null, approvedAt: null, override: false, overrideReason: null, supersededAt: null, supersededByVersionId: null, version: 1,
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
      async approve(versionId, input = {}) {
        const version = versionOrFail(versionId);
        const plan = db.plans.find((p) => p.id === version.planId)!;
        const { memberships } = requireUser();
        const head = memberships.find((m) => m.role === 'head_coach');
        const coordinator = memberships.find((m) => m.role === 'coordinator' && m.units.includes(plan.unit));
        if (!head && !coordinator) fail('forbidden', 'Only the unit coordinator or the head coach can approve.', 403);
        if (version.status !== 'in_review' && version.status !== 'draft') fail('conflict', 'This version cannot be approved from its current state.', 409);
        // D-014: a head-coach approval is an override and records why; the reason stays with the version.
        const override = !coordinator && !!head;
        const overrideReason = input.overrideReason?.trim() || null;
        if (override && !overrideReason) fail('validation_error', 'A head-coach override needs a reason; it is kept with the version and in the audit log.', 400, { reason: 'override_reason_required' });
        const ts = nowIso();
        // The previous approved version keeps its approver, time, flag and reason; it only learns what superseded it (HC-03).
        for (const other of db.planVersions) {
          if (other.planId === plan.id && other.status === 'approved') {
            other.status = 'superseded';
            other.supersededAt = ts;
            other.supersededByVersionId = version.id;
          }
        }
        version.status = 'approved';
        version.approvedBy = session!.userId;
        version.approvedAt = ts;
        version.override = override;
        version.overrideReason = override ? overrideReason : null;
        version.version += 1;
        plan.currentVersionId = version.id;
        return delay(version);
      },
      async comment(versionId, input) {
        versionOrFail(versionId);
        if (!input.body.trim()) fail('validation_error', 'Write a comment first.', 400);
        const comment: PlanComment = { id: newId('pc'), versionId, sectionKey: input.sectionKey as PlanSectionKey | null, itemId: input.itemId, authorUserId: session!.userId, body: input.body.trim(), createdAt: nowIso(), resolvedAt: null };
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
