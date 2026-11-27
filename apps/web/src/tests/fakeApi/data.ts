/**
 * TEST FIXTURES. Everything in this file is fictional: the Winchester Hawks program, every
 * opponent, every coach and every player. It exists so the product shell's tests can run
 * without `apps/api`; nothing here ships in the app. The team's `environmentKind` is `demo`
 * so the tests also cover the environment label. No real player, coach or school appears.
 */
import type {
  Concept,
  DepthChart,
  GamePlan,
  GamePlanVersion,
  Invite,
  Label,
  LabelKey,
  LabelRevision,
  MediaAsset,
  ModelProvenance,
  Opponent,
  PersonnelPackage,
  PlanComment,
  PlanSection,
  PlaybookDocument,
  PlaybookVersion,
  Player,
  PlaySegment,
  ProcessingJob,
  ReportSnapshot,
  ScheduledGame,
  ScoutingFinding,
  Season,
  StaffMembership,
  Team,
  Unit,
  User,
} from '../../api/contracts';
import { PLAN_SECTION_TEMPLATES } from '../../api/contracts';
import type { TeamSettings } from '../../api/api';

/** The demo's fixed "now" so that "this week's game" is stable across machines and tests. */
export const DEMO_NOW = '2026-10-25T12:00:00.000Z';

const T = 'team-winchester-demo';
const S = 'season-2026';
const CREATED = '2026-08-01T15:00:00.000Z';

export const team: Team = {
  id: T,
  name: 'Winchester Hawks (demo)',
  shortName: 'Hawks',
  level: 'high_school',
  environmentKind: 'demo',
  timezone: 'America/New_York',
  createdAt: CREATED,
};

export const seasons: Season[] = [
  { id: 'season-2025', teamId: T, label: '2025', startsOn: '2025-08-22', endsOn: '2025-11-14', isCurrent: false },
  { id: S, teamId: T, label: '2026', startsOn: '2026-08-21', endsOn: '2026-11-20', isCurrent: true },
];

export const users: (User & { password: string })[] = [
  { id: 'user-head', email: 'head.coach@winchester-hawks.demo', displayName: 'Dana Whitlock', mfaEnabled: true, createdAt: CREATED, password: 'demo' },
  { id: 'user-oc', email: 'oc@winchester-hawks.demo', displayName: 'Marcus Ellery', mfaEnabled: true, createdAt: CREATED, password: 'demo' },
  { id: 'user-dc', email: 'dc@winchester-hawks.demo', displayName: 'Priya Sandoval', mfaEnabled: true, createdAt: CREATED, password: 'demo' },
  { id: 'user-ol', email: 'ol@winchester-hawks.demo', displayName: 'Tomas Greer', mfaEnabled: false, createdAt: CREATED, password: 'demo' },
  { id: 'user-analyst', email: 'analyst@winchester-hawks.demo', displayName: 'Jordan Pike', mfaEnabled: false, createdAt: CREATED, password: 'demo' },
];

/** The demo MFA code accepted by the mock. Shown on the sign-in screen in mock mode only. */
export const DEMO_MFA_CODE = '246810';

export const memberships: StaffMembership[] = [
  { id: 'mem-head', teamId: T, userId: 'user-head', role: 'head_coach', units: ['offense', 'defense', 'special_teams'], title: 'Head coach', active: true, createdAt: CREATED },
  { id: 'mem-oc', teamId: T, userId: 'user-oc', role: 'coordinator', units: ['offense'], title: 'Offensive coordinator', active: true, createdAt: CREATED },
  { id: 'mem-dc', teamId: T, userId: 'user-dc', role: 'coordinator', units: ['defense', 'special_teams'], title: 'Defensive coordinator / special teams', active: true, createdAt: CREATED },
  { id: 'mem-ol', teamId: T, userId: 'user-ol', role: 'position_coach', units: ['offense'], title: 'Offensive line', active: true, createdAt: CREATED },
  { id: 'mem-analyst', teamId: T, userId: 'user-analyst', role: 'analyst', units: ['offense', 'defense', 'special_teams'], title: 'Film analyst', active: true, createdAt: CREATED },
];

export const invites: Invite[] = [
  { id: 'inv-1', teamId: T, email: 'wr.coach@winchester-hawks.demo', role: 'position_coach', unit: 'offense', expiresAt: '2026-11-01T00:00:00.000Z', acceptedAt: null, createdBy: 'user-head', createdAt: '2026-10-25T00:00:00.000Z' },
];

export const opponents: Opponent[] = [
  { id: 'opp-harland', teamId: T, name: 'Harland Valley (demo)', shortName: 'Harland Valley', notes: '' },
  { id: 'opp-mercer', teamId: T, name: 'Mercer Pines (demo)', shortName: 'Mercer Pines', notes: '' },
  { id: 'opp-fairmont', teamId: T, name: 'Fairmont Ridge (demo)', shortName: 'Fairmont Ridge', notes: '' },
  { id: 'opp-rockbridge', teamId: T, name: 'Rockbridge (demo)', shortName: 'Rockbridge', notes: '' },
  { id: 'opp-stonebrook', teamId: T, name: 'Stonebrook (demo)', shortName: 'Stonebrook', notes: '' },
  { id: 'opp-caldwell', teamId: T, name: 'Caldwell Heights (demo)', shortName: 'Caldwell Heights', notes: '' },
  { id: 'opp-northgate', teamId: T, name: 'Northgate (demo)', shortName: 'Northgate', notes: '' },
  { id: 'opp-pinehollow', teamId: T, name: 'Pine Hollow (demo)', shortName: 'Pine Hollow', notes: 'Week 9 game postponed; make-up date pending.' },
  { id: 'opp-westmoor', teamId: T, name: 'Westmoor (demo)', shortName: 'Westmoor', notes: 'Three games of opponent film on hand.' },
  { id: 'opp-linden', teamId: T, name: 'Linden Falls (demo)', shortName: 'Linden Falls', notes: '' },
];

function game(
  id: string,
  week: number | null,
  kind: ScheduledGame['kind'],
  opponentId: string | null,
  location: ScheduledGame['location'],
  scheduledAt: string | null,
  status: ScheduledGame['status'],
  result: ScheduledGame['result'],
  notes = '',
): ScheduledGame {
  return { id, teamId: T, seasonId: S, week, kind, opponentId, location, scheduledAt, status, result, notes, version: 1, createdAt: CREATED, updatedAt: CREATED };
}

export const games: ScheduledGame[] = [
  game('game-w1', 1, 'regular', 'opp-harland', 'home', '2026-08-28T23:00:00.000Z', 'final', { ourScore: 24, theirScore: 14, outcome: 'win' }),
  game('game-w2', 2, 'regular', 'opp-mercer', 'away', '2026-09-04T23:00:00.000Z', 'final', { ourScore: 17, theirScore: 21, outcome: 'loss' }),
  game('game-w3', 3, 'regular', 'opp-fairmont', 'home', '2026-09-11T23:00:00.000Z', 'final', { ourScore: 31, theirScore: 7, outcome: 'win' }),
  game('game-w4', 4, 'regular', 'opp-rockbridge', 'away', '2026-09-18T23:00:00.000Z', 'final', { ourScore: 20, theirScore: 17, outcome: 'win' }),
  game('game-w5', 5, 'bye', null, null, null, 'scheduled', null, 'Bye week'),
  game('game-w6', 6, 'regular', 'opp-stonebrook', 'home', '2026-10-02T23:00:00.000Z', 'final', { ourScore: 10, theirScore: 28, outcome: 'loss' }),
  game('game-w7', 7, 'regular', 'opp-caldwell', 'away', '2026-10-09T23:00:00.000Z', 'final', { ourScore: 27, theirScore: 13, outcome: 'win' }),
  game('game-w8', 8, 'regular', 'opp-northgate', 'home', '2026-10-16T23:00:00.000Z', 'final', { ourScore: 35, theirScore: 21, outcome: 'win' }),
  game('game-w9', 9, 'regular', 'opp-pinehollow', 'home', null, 'postponed', null, 'Postponed from Fri 23 Oct (lightning); make-up date not set.'),
  game('game-w10', 10, 'regular', 'opp-westmoor', 'away', '2026-10-30T23:00:00.000Z', 'scheduled', null),
  game('game-w11', 11, 'regular', 'opp-linden', 'home', '2026-11-06T23:00:00.000Z', 'scheduled', null, 'Senior night'),
  game('game-playoff-1', null, 'playoff', null, null, null, 'scheduled', null, 'Opponent and date set by the bracket.'),
];

/** The game the workspace opens on: Week 10 at Westmoor. */
export const THIS_WEEK_GAME_ID = 'game-w10';

const defaultContext = (analyzedTeam: 'us' | 'opponent', analyzedUnit: MediaAsset['context']['analyzedUnit']): MediaAsset['context'] => ({
  analyzedTeam,
  analyzedUnit,
  perspective: 'sideline_fixed',
  teamCues: analyzedTeam === 'opponent' ? 'Westmoor in white jerseys, green helmets' : 'Hawks in navy jerseys, gold helmets',
});

export const assets: MediaAsset[] = [
  {
    id: 'asset-westmoor-1', teamId: T, gameId: 'game-w10', uploadedBy: 'user-analyst', kind: 'game_film',
    originalFilename: 'westmoor_vs_stonebrook_sideline.mp4', byteSize: 3_210_442_112, sha256: 'demo-sha-1', mimeType: 'video/mp4',
    durationSec: 6412.4, width: 1920, height: 1080, fps: 29.97, status: 'ready', rejectionReason: null,
    context: defaultContext('opponent', 'mixed'),
    quality: { stable: true, lineOfScrimmageVisible: true, allTwentyTwoVisible: false, notes: ['Fixed sideline camera; tight framing hides the far-side receivers on about a third of snaps.'], unevaluable: ['Jersey numbers on the far side'] },
    storageKey: 'demo/westmoor-1', proxyStorageKey: 'demo/westmoor-1/proxy', thumbnailSheetKey: 'demo/westmoor-1/thumbs', retentionUntil: '2027-10-21T00:00:00.000Z',
    createdAt: '2026-10-21T18:02:10.000Z', updatedAt: '2026-10-21T19:40:00.000Z',
  },
  {
    id: 'asset-westmoor-2', teamId: T, gameId: 'game-w10', uploadedBy: 'user-analyst', kind: 'game_film',
    originalFilename: 'westmoor_vs_caldwell_endzone.mp4', byteSize: 2_804_110_000, sha256: 'demo-sha-2', mimeType: 'video/mp4',
    durationSec: 5890.0, width: 1920, height: 1080, fps: 29.97, status: 'processing', rejectionReason: null,
    context: defaultContext('opponent', 'mixed'),
    quality: null, storageKey: 'demo/westmoor-2', proxyStorageKey: 'demo/westmoor-2/proxy', thumbnailSheetKey: null, retentionUntil: null,
    createdAt: '2026-10-25T10:12:00.000Z', updatedAt: '2026-10-25T11:58:00.000Z',
  },
  {
    id: 'asset-westmoor-3', teamId: T, gameId: 'game-w10', uploadedBy: 'user-ol', kind: 'game_film',
    originalFilename: 'westmoor_week7.mov', byteSize: 912_000_000, sha256: 'demo-sha-3', mimeType: 'video/quicktime',
    durationSec: null, width: null, height: null, fps: null, status: 'rejected',
    rejectionReason: 'The file has no video stream that ffprobe can read. Re-export as H.264 MP4 and upload again.',
    context: defaultContext('opponent', 'offense'),
    quality: null, storageKey: 'demo/westmoor-3', proxyStorageKey: null, thumbnailSheetKey: null, retentionUntil: null,
    createdAt: '2026-10-24T20:30:00.000Z', updatedAt: '2026-10-24T20:31:00.000Z',
  },
  {
    id: 'asset-northgate-us', teamId: T, gameId: 'game-w8', uploadedBy: 'user-analyst', kind: 'game_film',
    originalFilename: 'hawks_vs_northgate_sideline.mp4', byteSize: 3_002_000_000, sha256: 'demo-sha-4', mimeType: 'video/mp4',
    durationSec: 6210.0, width: 1920, height: 1080, fps: 59.94, status: 'ready', rejectionReason: null,
    context: defaultContext('us', 'mixed'),
    quality: { stable: true, lineOfScrimmageVisible: true, allTwentyTwoVisible: true, notes: [], unevaluable: [] },
    storageKey: 'demo/northgate', proxyStorageKey: 'demo/northgate/proxy', thumbnailSheetKey: 'demo/northgate/thumbs', retentionUntil: '2027-10-17T00:00:00.000Z',
    createdAt: '2026-10-17T14:00:00.000Z', updatedAt: '2026-10-17T16:20:00.000Z',
  },
  {
    id: 'asset-northgate-opp', teamId: T, gameId: 'game-w8', uploadedBy: 'user-analyst', kind: 'game_film',
    originalFilename: 'northgate_offense_cutups.mp4', byteSize: 1_410_000_000, sha256: 'demo-sha-5', mimeType: 'video/mp4',
    durationSec: 2710.0, width: 1280, height: 720, fps: 29.97, status: 'ready', rejectionReason: null,
    context: { analyzedTeam: 'opponent', analyzedUnit: 'offense', perspective: 'endzone', teamCues: 'Northgate in black jerseys' },
    quality: { stable: null, lineOfScrimmageVisible: true, allTwentyTwoVisible: false, notes: ['End-zone cut-ups: each play starts a second before the snap.'], unevaluable: ['Camera stability (cuts between plays)', 'Field position (no yard markers in frame)'] },
    storageKey: 'demo/northgate-opp', proxyStorageKey: 'demo/northgate-opp/proxy', thumbnailSheetKey: 'demo/northgate-opp/thumbs', retentionUntil: null,
    createdAt: '2026-10-18T09:00:00.000Z', updatedAt: '2026-10-18T10:30:00.000Z',
  },
];

export const jobs: ProcessingJob[] = [
  {
    id: 'job-1', teamId: T, assetId: 'asset-westmoor-2', kind: 'segment', status: 'running',
    progress: { done: 38, total: 100, message: 'Proposing play boundaries (38 of about 100 minutes scanned)' },
    attempt: 1, maxAttempts: 3, leaseExpiresAt: '2026-10-25T12:05:00.000Z', workerId: 'worker-demo', idempotencyKey: 'demo-key-1', configVersion: 'media-0.1',
    error: null, requestedBy: 'user-analyst', createdAt: '2026-10-25T10:20:00.000Z', startedAt: '2026-10-25T11:40:00.000Z', finishedAt: null, canceledAt: null,
  },
  {
    id: 'job-2', teamId: T, assetId: 'asset-westmoor-2', kind: 'infer_labels', status: 'queued',
    progress: { done: 0, total: null, message: 'Waiting for segments' },
    attempt: 0, maxAttempts: 3, leaseExpiresAt: null, workerId: null, idempotencyKey: 'demo-key-2', configVersion: 'ai-0.1',
    error: null, requestedBy: 'user-analyst', createdAt: '2026-10-25T10:20:00.000Z', startedAt: null, finishedAt: null, canceledAt: null,
  },
  {
    id: 'job-3', teamId: T, assetId: 'asset-westmoor-1', kind: 'infer_labels', status: 'failed',
    progress: { done: 12, total: 48, message: 'Stopped after 12 of 48 segments' },
    attempt: 3, maxAttempts: 3, leaseExpiresAt: null, workerId: 'worker-demo', idempotencyKey: 'demo-key-3', configVersion: 'ai-0.1',
    error: { code: 'provider_unavailable', message: 'No model provider is configured for this team. Labels can be entered by a coach.' },
    requestedBy: 'user-analyst', createdAt: '2026-10-21T19:45:00.000Z', startedAt: '2026-10-21T19:46:00.000Z', finishedAt: '2026-10-21T19:52:00.000Z', canceledAt: null,
  },
  ...(['validate', 'proxy', 'thumbnails', 'segment'] as const).map((kind, i): ProcessingJob => ({
    id: `job-w1-${kind}`, teamId: T, assetId: 'asset-westmoor-1', kind, status: 'succeeded',
    progress: { done: 1, total: 1, message: kind === 'segment' ? '48 play boundaries proposed' : 'Done' },
    attempt: 1, maxAttempts: 3, leaseExpiresAt: null, workerId: 'worker-demo', idempotencyKey: `demo-key-w1-${kind}`, configVersion: 'media-0.1',
    error: null, requestedBy: 'user-analyst', createdAt: '2026-10-21T18:30:00.000Z', startedAt: `2026-10-21T18:${31 + i * 15}:00.000Z`, finishedAt: `2026-10-21T18:${40 + i * 15}:00.000Z`, canceledAt: null,
  })),
  {
    id: 'job-w2-validate', teamId: T, assetId: 'asset-westmoor-2', kind: 'validate', status: 'succeeded',
    progress: { done: 1, total: 1, message: 'Readable H.264 stream, 98 min' },
    attempt: 1, maxAttempts: 3, leaseExpiresAt: null, workerId: 'worker-demo', idempotencyKey: 'demo-key-w2-validate', configVersion: 'media-0.1',
    error: null, requestedBy: 'user-analyst', createdAt: '2026-10-25T10:20:00.000Z', startedAt: '2026-10-25T10:21:00.000Z', finishedAt: '2026-10-25T10:22:00.000Z', canceledAt: null,
  },
  {
    id: 'job-w2-proxy', teamId: T, assetId: 'asset-westmoor-2', kind: 'proxy', status: 'succeeded',
    progress: { done: 5890, total: 5890, message: '720p proxy written' },
    attempt: 1, maxAttempts: 3, leaseExpiresAt: null, workerId: 'worker-demo', idempotencyKey: 'demo-key-w2-proxy', configVersion: 'media-0.1',
    error: null, requestedBy: 'user-analyst', createdAt: '2026-10-25T10:20:00.000Z', startedAt: '2026-10-25T10:22:00.000Z', finishedAt: '2026-10-25T11:30:00.000Z', canceledAt: null,
  },
  {
    id: 'job-w2-thumbs', teamId: T, assetId: 'asset-westmoor-2', kind: 'thumbnails', status: 'retry_wait',
    progress: { done: 240, total: 589, message: 'ffmpeg exited with code 137 (out of memory); retrying in 30 s' },
    attempt: 2, maxAttempts: 3, leaseExpiresAt: null, workerId: null, idempotencyKey: 'demo-key-w2-thumbs', configVersion: 'media-0.1',
    error: null, requestedBy: 'user-analyst', createdAt: '2026-10-25T10:20:00.000Z', startedAt: '2026-10-25T11:31:00.000Z', finishedAt: null, canceledAt: null,
  },
  {
    id: 'job-ng-infer', teamId: T, assetId: 'asset-northgate-us', kind: 'infer_labels', status: 'canceled',
    progress: { done: 3, total: 40, message: 'Canceled by a coach after 3 of 40 segments' },
    attempt: 1, maxAttempts: 3, leaseExpiresAt: null, workerId: 'worker-demo', idempotencyKey: 'demo-key-ng-infer', configVersion: 'ai-0.1',
    error: null, requestedBy: 'user-head', createdAt: '2026-10-17T16:30:00.000Z', startedAt: '2026-10-17T16:31:00.000Z', finishedAt: '2026-10-17T16:33:00.000Z', canceledAt: '2026-10-17T16:33:00.000Z',
  },
];

export const segments: PlaySegment[] = Array.from({ length: 48 }, (_, i) => {
  const start = 120 + i * 128.5;
  const reviewStatus: PlaySegment['reviewStatus'] = i < 31 ? 'accepted' : i === 40 ? 'rejected' : 'proposed';
  return {
    id: `seg-westmoor-1-${i + 1}`, teamId: T, assetId: 'asset-westmoor-1', gameId: 'game-w10', index: i + 1,
    startSec: Math.round(start * 10) / 10, endSec: Math.round((start + 7.4) * 10) / 10,
    origin: i === 17 ? 'coach_split' : 'proposed', reviewStatus, supersededBy: [], version: 1,
    createdAt: '2026-10-21T19:40:00.000Z', updatedAt: '2026-10-22T13:00:00.000Z',
  };
});

const ev = (atSec: number, note: string | null = null) => ({ assetId: 'asset-westmoor-1', atSec, toSec: null, frameIndex: null, note });
/** A moment inside seeded play `index` (plays start at 120 s and repeat every 128.5 s; see `segments`). */
export const snapSec = (index: number, offsetSec = 1.5) => Math.round((120 + (index - 1) * 128.5 + offsetSec) * 10) / 10;

function finding(
  id: string,
  opponentId: string,
  unit: Unit,
  kind: ScoutingFinding['kind'],
  statement: string,
  numerator: number,
  denominator: number,
  reviewBasis: ScoutingFinding['reviewBasis'],
  extras: Partial<ScoutingFinding> = {},
): ScoutingFinding {
  return {
    id, teamId: T, opponentId, gameIds: ['game-w10'], unit, kind, statement, numerator, denominator,
    percent: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null,
    sampleSize: denominator, includedSegmentIds: [], excludedSegmentIds: [], excludedReason: {}, reviewBasis,
    supportingEvidence: [], contraryEvidence: [], computedAt: '2026-10-24T09:00:00.000Z', computeVersion: 'stats-0.1', ...extras,
  };
}

export const findings: ScoutingFinding[] = [
  finding('f-1', 'opp-westmoor', 'offense', 'formation_frequency', 'Westmoor lines up in a trips formation on first down.', 19, 54, 'reviewed_only', {
    supportingEvidence: [ev(snapSec(2), 'Trips right, 1st and 10'), ev(snapSec(15), 'Trips left, 1st and 10')],
    excludedSegmentIds: ['seg-westmoor-1-33', 'seg-westmoor-1-34'], excludedReason: { 'seg-westmoor-1-33': 'formation label not reviewed', 'seg-westmoor-1-34': 'far-side receivers hidden' },
  }),
  finding('f-2', 'opp-westmoor', 'offense', 'tendency_by_situation', 'On second down with 3 yards or fewer to go, Westmoor runs the ball.', 9, 11, 'includes_inferred', {
    supportingEvidence: [ev(snapSec(19, 2.0), '2nd and 2, inside zone')], contraryEvidence: [ev(snapSec(31, 2.0), '2nd and 1, quick pass to the flat')],
  }),
  finding('f-3', 'opp-westmoor', 'offense', 'play_type_by_formation', 'From 12 personnel, Westmoor passes.', 6, 17, 'reviewed_only', { supportingEvidence: [ev(snapSec(26))] }),
  finding('f-4', 'opp-westmoor', 'offense', 'uncertain', 'Westmoor may favour screens on third and long; the sample is too small to call a tendency.', 3, 7, 'includes_inferred', {
    excludedReason: { 'seg-westmoor-1-41': 'down and distance not visible' }, excludedSegmentIds: ['seg-westmoor-1-41'],
  }),
  finding('f-5', 'opp-westmoor', 'defense', 'formation_frequency', 'Against 11 personnel, Westmoor shows an even front.', 31, 44, 'reviewed_only', { supportingEvidence: [ev(640.0)] }),
  finding('f-6', 'opp-westmoor', 'defense', 'strength', 'Westmoor brings a fifth rusher on third and 7 or more.', 8, 13, 'includes_inferred'),
  finding('f-7', 'opp-westmoor', 'defense', 'weakness', 'The boundary corner plays off coverage against a single receiver.', 14, 22, 'reviewed_only', { contraryEvidence: [ev(snapSec(40), 'Press at the goal line')] }),
  finding('f-8', 'opp-westmoor', 'defense', 'uncertain', 'Westmoor may rotate the safety late toward trips; the camera framing hides the far safety on most of these snaps.', 4, 9, 'includes_inferred', {
    excludedReason: { 'seg-westmoor-1-12': 'far safety outside the frame' }, excludedSegmentIds: ['seg-westmoor-1-12'],
  }),
  finding('f-9', 'opp-westmoor', 'special_teams', 'tendency_by_situation', 'Westmoor uses a rugby-style punt from its own half.', 6, 8, 'reviewed_only'),
  finding('f-10', 'opp-westmoor', 'special_teams', 'uncertain', 'Westmoor may fake a punt on fourth and short near midfield; one snap is not a tendency.', 1, 3, 'reviewed_only'),
  finding('f-11', 'opp-pinehollow', 'offense', 'formation_frequency', 'Pine Hollow runs from under centre with two backs.', 22, 40, 'includes_inferred'),
];

function sectionsFor(unit: Unit, items: Partial<Record<string, string[]>>): PlanSection[] {
  return PLAN_SECTION_TEMPLATES[unit].map((tpl) => ({
    key: tpl.key,
    title: tpl.title,
    items: (items[tpl.key] ?? []).map((text, i) => ({
      id: `${unit}-${tpl.key}-${i + 1}`, text, sourceRecommendationId: null, conceptIds: [], packageIds: [], order: i + 1,
    })),
  }));
}

export const plans: GamePlan[] = [
  { id: 'plan-w10-off', teamId: T, gameId: 'game-w10', unit: 'offense', currentVersionId: 'pv-off-2', createdAt: '2026-10-19T12:00:00.000Z' },
  { id: 'plan-w10-def', teamId: T, gameId: 'game-w10', unit: 'defense', currentVersionId: 'pv-def-1', createdAt: '2026-10-19T12:00:00.000Z' },
  { id: 'plan-w10-st', teamId: T, gameId: 'game-w10', unit: 'special_teams', currentVersionId: 'pv-st-1', createdAt: '2026-10-19T12:00:00.000Z' },
];

export const planVersions: GamePlanVersion[] = [
  {
    id: 'pv-off-1', planId: 'plan-w10-off', number: 1, status: 'approved', basedOn: null, createdBy: 'user-oc', createdAt: '2026-10-19T12:00:00.000Z',
    approvedBy: 'user-oc', approvedAt: '2026-10-22T21:10:00.000Z', override: false, overrideReason: null, supersededAt: null, supersededByVersionId: null, version: 3,
    sections: sectionsFor('offense', {
      objectives: ['Win first down: stay ahead of the chains against the even front.', 'Protect the quarterback against the fifth rusher on third and long.'],
      personnel: ['11 personnel as the base; 12 personnel for short yardage.'],
      runs: ['Inside zone to the boundary.', 'Counter away from the overhang.'],
      passes: ['Flood to the field against the off corner.'],
      third_down: ['Quick game under the two-high shell.'],
    }),
  },
  {
    id: 'pv-off-2', planId: 'plan-w10-off', number: 2, status: 'draft', basedOn: 'pv-off-1', createdBy: 'user-oc', createdAt: '2026-10-24T13:30:00.000Z',
    approvedBy: null, approvedAt: null, override: false, overrideReason: null, supersededAt: null, supersededByVersionId: null, version: 2,
    sections: sectionsFor('offense', {
      objectives: ['Win first down: stay ahead of the chains against the even front.', 'Protect the quarterback against the fifth rusher on third and long.'],
      personnel: ['11 personnel as the base; 12 personnel for short yardage.', 'Jumbo package inside the 5.'],
      formations: ['Trips to the field to test the late safety rotation (finding still uncertain).'],
      runs: ['Inside zone to the boundary.', 'Counter away from the overhang.', 'Power from 12 personnel on second and short.'],
      passes: ['Flood to the field against the off corner.', 'Hitch to the boundary against off coverage (14 of 22 reviewed snaps).'],
      protections: ['Slide to the pressure side on third and 7 or more.'],
      opening_script: ['1. Inside zone  2. Hitch boundary  3. Counter  4. Flood'],
      third_down: ['Quick game under the two-high shell.'],
      red_zone: ['Power and the sprint-out pass.'],
    }),
  },
  {
    id: 'pv-def-1', planId: 'plan-w10-def', number: 1, status: 'in_review', basedOn: null, createdBy: 'user-dc', createdAt: '2026-10-23T15:00:00.000Z',
    approvedBy: null, approvedAt: null, override: false, overrideReason: null, supersededAt: null, supersededByVersionId: null, version: 4,
    sections: sectionsFor('defense', {
      opponent_tendencies: ['Trips on first down (19 of 54 reviewed snaps).', 'Run on second and 3 or fewer (9 of 11; includes unreviewed labels).'],
      fronts: ['Over front against trips; set the strength to the three-receiver side.'],
      fits: ['Scrape exchange against inside zone.'],
      coverages: ['Quarters as the base; cloud to the trips side.'],
      pressures: ['Field pressure on second and short run downs.'],
      matchups: ['Our boundary corner on their single receiver.'],
      third_down: ['Match the screen alert on third and long; the tendency is not established.'],
    }),
  },
  {
    id: 'pv-st-1', planId: 'plan-w10-st', number: 1, status: 'draft', basedOn: null, createdBy: 'user-dc', createdAt: '2026-10-24T09:00:00.000Z',
    approvedBy: null, approvedAt: null, override: false, overrideReason: null, supersededAt: null, supersededByVersionId: null, version: 1,
    sections: sectionsFor('special_teams', {
      punt_protection_return: ['Rugby punt alert: contain the roll-out side (6 of 8 reviewed punts).'],
      opponent_alerts: ['Possible fake punt on fourth and short at midfield: one snap, not a tendency.'],
    }),
  },
];

export const planComments: PlanComment[] = [
  { id: 'pc-1', versionId: 'pv-off-2', sectionKey: 'formations', itemId: null, authorUserId: 'user-head', body: 'Hold the trips test until the safety finding is reviewed on film; it is still marked uncertain.', createdAt: '2026-10-24T16:00:00.000Z', resolvedAt: null },
  { id: 'pc-2', versionId: 'pv-off-2', sectionKey: 'runs', itemId: 'offense-runs-3', authorUserId: 'user-ol', body: 'Power from 12 needs the second tight end healthy; check Personnel.', createdAt: '2026-10-24T18:20:00.000Z', resolvedAt: '2026-10-25T08:00:00.000Z' },
  { id: 'pc-3', versionId: 'pv-def-1', sectionKey: null, itemId: null, authorUserId: 'user-head', body: 'Ready for approval once the third-down note is reworded.', createdAt: '2026-10-25T09:30:00.000Z', resolvedAt: null },
];

export const playbookDocuments: PlaybookDocument[] = [
  {
    id: 'pbdoc-off-1', teamId: T, unit: 'offense', title: '2026 offensive installation (demo)', assetId: 'asset-doc-1', pageCount: 42, status: 'extracted',
    extraction: { basis: 'text', note: 'Text layer read on every page; 4 concepts proposed from headings.', warnings: [], conceptsProposed: 4, termsProposed: 0, pagesWithoutText: 0 },
    createdBy: 'user-oc', createdAt: '2026-08-05T12:00:00.000Z', updatedAt: '2026-08-05T12:40:00.000Z',
  },
  {
    id: 'pbdoc-off-2', teamId: T, unit: 'offense', title: 'Red-zone supplement (demo)', assetId: 'asset-doc-2', pageCount: 9, status: 'review',
    extraction: { basis: 'text', note: 'Scanned pages read by OCR; two low-confidence proposals need a coach to confirm the names.', warnings: ['OCR confidence below 0.6 on pages 4 and 7'], conceptsProposed: 2, termsProposed: 0, pagesWithoutText: 0 },
    createdBy: 'user-oc', createdAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:30:00.000Z',
  },
  {
    id: 'pbdoc-def-1', teamId: T, unit: 'defense', title: 'Base 4-2-5 manual (demo)', assetId: 'asset-doc-3', pageCount: 31, status: 'extracting',
    extraction: null, createdBy: 'user-dc', createdAt: '2026-10-24T17:00:00.000Z', updatedAt: '2026-10-24T17:00:00.000Z',
  },
];

export const playbookVersions: PlaybookVersion[] = [
  { id: 'pbv-off-1', teamId: T, unit: 'offense', seasonId: S, label: '2026 install', status: 'approved', approvedBy: 'user-oc', approvedAt: '2026-08-12T12:00:00.000Z', supersedes: null, createdBy: 'user-oc', createdAt: '2026-08-05T12:00:00.000Z' },
  { id: 'pbv-off-2', teamId: T, unit: 'offense', seasonId: S, label: '2026 install + red zone', status: 'draft', approvedBy: null, approvedAt: null, supersedes: 'pbv-off-1', createdBy: 'user-oc', createdAt: '2026-10-10T12:00:00.000Z' },
  { id: 'pbv-def-1', teamId: T, unit: 'defense', seasonId: S, label: '2026 base defense', status: 'draft', approvedBy: null, approvedAt: null, supersedes: null, createdBy: 'user-dc', createdAt: '2026-10-24T17:00:00.000Z' },
];

const src = (documentId: string, pageNumber: number, excerpt: string) => ({ documentId, pageNumber, bbox: null, excerpt });

export const concepts: Concept[] = [
  { id: 'c-1', teamId: T, versionId: 'pbv-off-2', name: 'Inside Zone', kind: 'run', description: 'Zone run to the play side; back aims at the guard’s outside leg.', installed: true, sources: [src('pbdoc-off-1', 12, 'Inside Zone: covered linemen base, uncovered linemen combo to the backer.')], status: 'approved', basis: 'text', note: 'Proposed from a page heading in the text layer.', decidedBy: 'user-oc', decidedAt: '2026-08-12T12:00:00.000Z', version: 1, createdAt: '2026-08-05T12:40:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z' },
  { id: 'c-2', teamId: T, versionId: 'pbv-off-2', name: 'Power', kind: 'run', description: 'Gap scheme with a backside guard pull.', installed: true, sources: [src('pbdoc-off-1', 15, 'Power: down, down, kick, pull.')], status: 'approved', basis: 'text', note: 'Proposed from a page heading in the text layer.', decidedBy: 'user-oc', decidedAt: '2026-08-12T12:00:00.000Z', version: 1, createdAt: '2026-08-05T12:40:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z' },
  { id: 'c-3', teamId: T, versionId: 'pbv-off-2', name: 'Counter', kind: 'run', description: 'Gap scheme with two backside pullers.', installed: true, sources: [src('pbdoc-off-1', 17, 'Counter: guard kicks, tackle wraps.')], status: 'approved', basis: 'text', note: 'Proposed from a page heading in the text layer.', decidedBy: 'user-oc', decidedAt: '2026-08-12T12:00:00.000Z', version: 1, createdAt: '2026-08-05T12:40:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z' },
  { id: 'c-4', teamId: T, versionId: 'pbv-off-2', name: 'Flood', kind: 'pass', description: 'Three-level stretch to the field.', installed: true, sources: [src('pbdoc-off-1', 28, 'Flood: corner, out, flat.')], status: 'approved', basis: 'text', note: 'Proposed from a page heading in the text layer.', decidedBy: 'user-oc', decidedAt: '2026-08-12T12:00:00.000Z', version: 1, createdAt: '2026-08-05T12:40:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z' },
  { id: 'c-5', teamId: T, versionId: 'pbv-off-2', name: 'Sprint-out Smash', kind: 'pass', description: 'Extracted from the red-zone supplement; OCR text is unreviewed.', installed: false, sources: [src('pbdoc-off-2', 4, 'Sprint Smash (OCR): hitch-corner to the sprint side.')], status: 'proposed', basis: 'text', note: 'Proposed from OCR text; the page image was not interpreted.', decidedBy: null, decidedAt: null, version: 1, createdAt: '2026-10-10T12:30:00.000Z', updatedAt: '2026-10-10T12:30:00.000Z' },
  { id: 'c-6', teamId: T, versionId: 'pbv-off-2', name: 'Jumbo Wedge', kind: 'run', description: 'Extracted from the red-zone supplement; needs a coach to confirm the name.', installed: false, sources: [src('pbdoc-off-2', 7, 'Wedge (OCR, low confidence)')], status: 'proposed', basis: 'text', note: 'Proposed from OCR text; the page image was not interpreted.', decidedBy: null, decidedAt: null, version: 1, createdAt: '2026-10-10T12:30:00.000Z', updatedAt: '2026-10-10T12:30:00.000Z' },
  { id: 'c-7', teamId: T, versionId: 'pbv-off-2', name: 'Half Slide', kind: 'protection', description: 'Extracted from page 33; duplicates an approved concept name in version 1.', installed: false, sources: [src('pbdoc-off-1', 33, 'Half slide protection.')], status: 'rejected', basis: 'text', note: 'Proposed from a page heading in the text layer.', decidedBy: 'user-oc', decidedAt: '2026-10-11T09:00:00.000Z', version: 2, createdAt: '2026-08-05T12:40:00.000Z', updatedAt: '2026-10-11T09:00:00.000Z' },
];

const P = (
  id: string, jersey: string, firstName: string, lastName: string, positions: string[], classYear: string,
  status: Player['status'] = 'active', strengths: string[] = [], developmentPriorities: string[] = [], notes = '',
): Player => ({ id, teamId: T, seasonId: S, jersey, firstName, lastName, positions, classYear, status, strengths, developmentPriorities, notes, availability: [], version: 1, createdAt: CREATED, updatedAt: CREATED });

export const players: Player[] = [
  P('p-7', '7', 'Eli', 'Marchetti', ['QB'], 'Senior', 'active', ['Quick release'], ['Reads against two-high']),
  P('p-12', '12', 'Noah', 'Brandt', ['QB'], 'Sophomore'),
  P('p-22', '22', 'Devon', 'Castile', ['RB'], 'Junior', 'active', ['Vision on zone runs']),
  P('p-33', '33', 'Sam', 'Okafor', ['RB', 'LB'], 'Junior', 'injured', [], [], 'Ankle; week to week.'),
  P('p-1', '1', 'Kai', 'Thornton', ['WR'], 'Senior', 'active', ['Release vs press']),
  P('p-4', '4', 'Luis', 'Pereira', ['WR'], 'Junior'),
  P('p-11', '11', 'Ben', 'Adeyemi', ['WR', 'CB'], 'Sophomore'),
  P('p-85', '85', 'Owen', 'Faulkner', ['TE'], 'Senior', 'active', ['Blocking at the point']),
  P('p-88', '88', 'Reed', 'Lindqvist', ['TE'], 'Junior', 'unavailable', [], [], 'Academic hold through Monday.'),
  P('p-62', '62', 'Micah', 'Delacroix', ['LG'], 'Junior', 'active', ['First step'], ['Hand placement at contact']),
  P('p-55', '55', 'Jonah', 'Whitfield', ['C'], 'Senior'),
  P('p-64', '64', 'Carter', 'Nguyen', ['RG'], 'Junior'),
  P('p-71', '71', 'Amari', 'Boateng', ['LT'], 'Senior', 'active', ['Pass set']),
  P('p-76', '76', 'Theo', 'Ramsay', ['RT'], 'Sophomore', 'active', [], ['Anchor vs power rush']),
  P('p-66', '66', 'Felix', 'Osei', ['OL'], 'Freshman'),
  P('p-90', '90', 'Dante', 'Rourke', ['DE'], 'Senior', 'active', ['Edge speed']),
  P('p-94', '94', 'Isaiah', 'Mbeki', ['DT'], 'Junior'),
  P('p-99', '99', 'Grant', 'Holloway', ['DT'], 'Senior'),
  P('p-44', '44', 'Rowan', 'Kessler', ['LB'], 'Senior', 'active', ['Run fits']),
  P('p-40', '40', 'Jace', 'Villanueva', ['LB'], 'Junior'),
  P('p-21', '21', 'Malik', 'Stroud', ['CB'], 'Senior', 'active', ['Press technique']),
  P('p-24', '24', 'Caleb', 'Ferreira', ['CB'], 'Sophomore'),
  P('p-3', '3', 'Ezra', 'Montclair', ['S'], 'Junior'),
  P('p-9', '9', 'Tariq', 'Bellamy', ['S', 'WR'], 'Senior'),
  P('p-17', '17', 'Hugo', 'Lindgren', ['K', 'P'], 'Junior', 'active', ['Rugby punt']),
];

export const depthCharts: DepthChart[] = [
  {
    id: 'dc-off', teamId: T, seasonId: S, unit: 'offense', version: 2, updatedAt: '2026-10-20T12:00:00.000Z',
    slots: [
      { position: 'QB', order: 1, playerId: 'p-7' }, { position: 'QB', order: 2, playerId: 'p-12' },
      { position: 'RB', order: 1, playerId: 'p-22' }, { position: 'RB', order: 2, playerId: 'p-33' },
      { position: 'WR-X', order: 1, playerId: 'p-1' }, { position: 'WR-Z', order: 1, playerId: 'p-4' }, { position: 'WR-H', order: 1, playerId: 'p-11' },
      { position: 'TE', order: 1, playerId: 'p-85' }, { position: 'TE', order: 2, playerId: 'p-88' },
      { position: 'LT', order: 1, playerId: 'p-71' }, { position: 'LG', order: 1, playerId: 'p-62' }, { position: 'C', order: 1, playerId: 'p-55' },
      { position: 'RG', order: 1, playerId: 'p-64' }, { position: 'RT', order: 1, playerId: 'p-76' }, { position: 'OL', order: 2, playerId: 'p-66' },
    ],
  },
  {
    id: 'dc-def', teamId: T, seasonId: S, unit: 'defense', version: 1, updatedAt: CREATED,
    slots: [
      { position: 'DE', order: 1, playerId: 'p-90' }, { position: 'DT', order: 1, playerId: 'p-94' }, { position: 'DT', order: 2, playerId: 'p-99' },
      { position: 'LB', order: 1, playerId: 'p-44' }, { position: 'LB', order: 2, playerId: 'p-40' },
      { position: 'CB', order: 1, playerId: 'p-21' }, { position: 'CB', order: 2, playerId: 'p-24' },
      { position: 'S', order: 1, playerId: 'p-3' }, { position: 'S', order: 2, playerId: 'p-9' },
    ],
  },
  {
    id: 'dc-st', teamId: T, seasonId: S, unit: 'special_teams', version: 1, updatedAt: CREATED,
    slots: [{ position: 'K', order: 1, playerId: 'p-17' }, { position: 'P', order: 1, playerId: 'p-17' }, { position: 'KR', order: 1, playerId: 'p-11' }],
  },
];

export const packages: PersonnelPackage[] = [
  { id: 'pkg-11', teamId: T, seasonId: S, unit: 'offense', name: '11 personnel', playerIds: ['p-7', 'p-22', 'p-1', 'p-4', 'p-11', 'p-85'], description: 'One back, one tight end, three receivers. Base package.', version: 1, createdAt: CREATED, updatedAt: CREATED },
  { id: 'pkg-12', teamId: T, seasonId: S, unit: 'offense', name: '12 personnel', playerIds: ['p-7', 'p-22', 'p-1', 'p-4', 'p-85', 'p-88'], description: 'One back, two tight ends. Short yardage; second tight end currently unavailable.', version: 1, createdAt: CREATED, updatedAt: CREATED },
  { id: 'pkg-jumbo', teamId: T, seasonId: S, unit: 'offense', name: 'Jumbo', playerIds: ['p-7', 'p-22', 'p-33', 'p-85', 'p-88', 'p-66'], description: 'Goal line.', version: 1, createdAt: CREATED, updatedAt: CREATED },
  { id: 'pkg-dime', teamId: T, seasonId: S, unit: 'defense', name: 'Dime', playerIds: ['p-90', 'p-94', 'p-44', 'p-21', 'p-24', 'p-3', 'p-9', 'p-11'], description: 'Six defensive backs for third and long.', version: 1, createdAt: CREATED, updatedAt: CREATED },
];

export const settings: TeamSettings = {
  retentionDays: 365,
  uploadLimits: { maxUploadBytes: 8 * 1024 ** 3, uploadChunkBytes: 8 * 1024 ** 2, allowedVideoContainers: ['mp4', 'mov'], uploadTtlHours: 24 },
  version: 1,
};

// §6 labels, provenance and revisions for the reviewed Westmoor film ----------------------
//
// Demo story: the first 12 of 48 segments were labeled by a model during an evaluation run
// (provenance below); the provider was then removed from the team's configuration, so the
// `infer_labels` job above stopped with `provider_unavailable`. Segments 13–48 have label
// rows without an inferred block (`accepted.status: 'unknown'`) so a coach can fill them in.

/** Keys the demo labels cover, in review-table order. */
export const DEMO_LABEL_KEYS: LabelKey[] = ['unit', 'play_type', 'formation_family', 'personnel_estimate', 'alignment', 'hash', 'motion', 'situation_down'];

const INFERRED_SEGMENTS = 12;
const LABELED_AT = '2026-10-21T19:50:00.000Z';
const REVIEWED_AT = '2026-10-22T13:00:00.000Z';

const FORMATIONS = ['trips_right', 'trips_left', 'doubles', 'ace', 'i_form', 'empty'];
const PLAY_TYPES: (string | null)[] = ['run', 'pass', 'pass', 'run', 'run', 'pass', 'other', 'run', 'pass', 'run', 'pass', 'run'];

function inferredFor(segmentIndex: number, key: LabelKey): Label['inferred'] {
  const i = segmentIndex - 1;
  const at = 120 + i * 128.5;
  const evidence = (note: string) => [{ assetId: 'asset-westmoor-1', atSec: Math.round((at + 1.2) * 10) / 10, toSec: Math.round((at + 4.0) * 10) / 10, frameIndex: null, note }];
  switch (key) {
    case 'unit':
      return { value: 'offense', abstained: false, rationale: 'Eleven players set on the line of scrimmage facing the camera; quarterback under centre or in shotgun.', evidence: evidence('Pre-snap alignment'), uncertainty: 'low' };
    case 'play_type': {
      const value = PLAY_TYPES[i % PLAY_TYPES.length];
      if (i === 6) return { value: null, abstained: true, rationale: 'Ball carrier hidden behind the far-side linemen; neither a handoff nor a throw is visible in the sampled frames.', evidence: evidence('Frames 2–5'), uncertainty: null };
      return { value, abstained: false, rationale: value === 'run' ? 'Handoff visible at frame 3; linemen fire out.' : 'Quarterback drops; linemen set in pass protection.', evidence: evidence('Snap plus two frames'), uncertainty: i % 5 === 0 ? 'medium' : 'low' };
    }
    case 'formation_family':
      return { value: FORMATIONS[i % FORMATIONS.length], abstained: false, rationale: 'Receiver count and backfield set in the pre-snap frame.', evidence: evidence('Pre-snap frame'), uncertainty: i % 4 === 3 ? 'high' : 'low' };
    case 'personnel_estimate':
      if (i % 6 === 5) return { value: null, abstained: true, rationale: 'Far-side receivers outside the frame; tight-end count cannot be established.', evidence: evidence('Pre-snap frame'), uncertainty: null };
      return { value: i % 3 === 0 ? '12' : '11', abstained: false, rationale: 'One back and the visible tight ends counted in the pre-snap frame.', evidence: evidence('Pre-snap frame'), uncertainty: 'medium' };
    case 'alignment':
      return { value: i % 2 === 0 ? 'strength_right' : 'strength_left', abstained: false, rationale: 'Tight end and the extra receiver aligned to that side.', evidence: evidence('Pre-snap frame'), uncertainty: 'low' };
    case 'hash':
      if (i % 4 === 1) return { value: null, abstained: true, rationale: 'Hash marks not visible from this framing.', evidence: evidence('Pre-snap frame'), uncertainty: null };
      return { value: i % 3 === 0 ? 'left' : i % 3 === 1 ? 'middle' : 'right', abstained: false, rationale: 'Ball placed relative to the visible hash marks.', evidence: evidence('Pre-snap frame'), uncertainty: 'medium' };
    case 'motion':
      return { value: i % 3 === 2 ? 'yes' : 'no', abstained: false, rationale: i % 3 === 2 ? 'A receiver crosses the formation before the snap.' : 'No pre-snap movement in the sampled frames.', evidence: evidence('Frames before the snap'), uncertainty: 'low' };
    case 'situation_down':
      // Evidence-only key (CONTRACTS §6): no down marker or scoreboard in frame → abstain.
      return { value: null, abstained: true, rationale: 'No down marker or scoreboard graphic visible; down is never inferred from play context.', evidence: [], uncertainty: null };
    default:
      return null;
  }
}

/** Coach actions on the inferred labels so the review table shows every status. */
function acceptedFor(segmentIndex: number, key: LabelKey, inferred: Label['inferred']): Label['accepted'] {
  const i = segmentIndex - 1;
  if (!inferred) return { value: null, status: 'unknown', byUserId: null, at: null };
  // Segments 1–4 were fully reviewed by the analyst.
  if (i < 4) {
    if (inferred.abstained) return { value: key === 'situation_down' ? (i === 0 ? '1' : null) : null, status: key === 'situation_down' && i === 0 ? 'corrected' : 'unknown', byUserId: 'user-analyst', at: REVIEWED_AT };
    if (key === 'formation_family' && i === 1) return { value: 'doubles', status: 'corrected', byUserId: 'user-analyst', at: REVIEWED_AT };
    if (key === 'play_type' && i === 2) return { value: 'pass', status: 'corrected', byUserId: 'user-oc', at: REVIEWED_AT };
    return { value: inferred.value, status: 'accepted', byUserId: 'user-analyst', at: REVIEWED_AT };
  }
  // Segment 5: one label rejected as unusable.
  if (i === 4 && key === 'hash') return { value: null, status: 'rejected', byUserId: 'user-analyst', at: REVIEWED_AT };
  // Everything else is still the model's proposal.
  return { value: inferred.value, status: 'inferred', byUserId: null, at: null };
}

export const provenance: ModelProvenance[] = Array.from({ length: INFERRED_SEGMENTS }, (_, i) => {
  const start = 120 + i * 128.5;
  const frames = Array.from({ length: 6 }, (_, f) => Math.round((start + 0.5 + f * 1.2) * 10) / 10);
  return {
    id: `prov-westmoor-1-${i + 1}`, provider: 'ollama', model: 'qwen3-vl:4b', modelRevision: null, promptId: 'label-v1', promptHash: 'sha256:3f9a1c…fixture',
    preprocessing: { samplingFps: 1, frameCount: frames.length, clipSec: 7.4, resolution: '1280x720' },
    inspected: { fromSec: frames[0], toSec: frames[frames.length - 1], frameTimestampsSec: frames },
    analysisVersion: 'ai-0.1', inputTokens: 5400 + i * 37, outputTokens: 310 + i * 3, costUsd: 0, latencyMs: 4200 + i * 110,
    requestedAt: `2026-10-21T19:46:${String(i * 4).padStart(2, '0')}.000Z`, completedAt: `2026-10-21T19:46:${String(i * 4 + 3).padStart(2, '0')}.500Z`,
  };
});

export const labels: Label[] = segments.flatMap((segment) =>
  DEMO_LABEL_KEYS.map((key): Label => {
    const inferred = segment.index <= INFERRED_SEGMENTS ? inferredFor(segment.index, key) : null;
    const accepted = acceptedFor(segment.index, key, inferred);
    return {
      id: `label-${segment.index}-${key}`, teamId: T, segmentId: segment.id, key, inferred, accepted,
      provenanceId: inferred ? `prov-westmoor-1-${segment.index}` : null,
      version: accepted.status === 'inferred' || accepted.status === 'unknown' ? 1 : 2,
      createdAt: inferred ? LABELED_AT : '2026-10-21T19:40:00.000Z', updatedAt: accepted.at ?? (inferred ? LABELED_AT : '2026-10-21T19:40:00.000Z'),
    };
  }),
);

export const labelRevisions: LabelRevision[] = labels
  .filter((l) => l.accepted.status !== 'inferred' && l.accepted.status !== 'unknown')
  .map((l) => ({
    id: `rev-${l.id}`, labelId: l.id, previousValue: l.inferred?.value ?? null, newValue: l.accepted.value, previousStatus: 'inferred', newStatus: l.accepted.status,
    byUserId: l.accepted.byUserId ?? 'user-analyst', at: l.accepted.at ?? REVIEWED_AT,
    reason: l.accepted.status === 'corrected' ? (l.key === 'situation_down' ? 'Down marker visible on the far sideline at the snap.' : 'Far-side receiver was stacked, not split.') : l.accepted.status === 'rejected' ? 'Camera pans during the snap; hash cannot be read.' : null,
  }));

export const snapshots: ReportSnapshot[] = [
  {
    id: 'snap-westmoor-off-1', teamId: T, opponentId: 'opp-westmoor', title: 'Westmoor offense — Tuesday install (demo)',
    findings: findings.filter((f) => f.opponentId === 'opp-westmoor' && f.unit === 'offense' && f.reviewBasis === 'reviewed_only'),
    generatedBy: 'user-dc', generatedAt: '2026-10-24T09:05:00.000Z', inputsHash: 'sha256:demo-snapshot-1',
  },
];
