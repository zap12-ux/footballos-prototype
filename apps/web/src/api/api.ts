import type {
  Concept,
  DepthChart,
  ErrorCode,
  GamePlan,
  GamePlanVersion,
  Invite,
  MediaAsset,
  Opponent,
  PersonnelPackage,
  PlanComment,
  PlaybookDocument,
  PlaybookVersion,
  Player,
  PlaySegment,
  ProcessingJob,
  Role,
  ScheduleImport,
  ScheduledGame,
  ScoutingFinding,
  Season,
  StaffMembership,
  Team,
  Unit,
  UploadContext,
  User,
} from './contracts';

/** Thrown by every Api implementation; mirrors the CONTRACTS §2 error envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** `GET /auth/me`: the signed-in user with the memberships the session can see. */
export interface Me {
  user: User;
  mfaVerified: boolean;
  memberships: StaffMembership[];
}

export type SignInResult = { kind: 'signed_in'; me: Me } | { kind: 'mfa_required' };

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Retention settings are a frontend proposal: CONTRACTS §12 has no settings route yet. */
export interface TeamSettings {
  teamId: string;
  retentionDays: number | null;
  autoDeleteOriginals: boolean;
  version: number;
}

export interface GamePlanBundle {
  plan: GamePlan;
  versions: GamePlanVersion[];
  comments: PlanComment[];
}

/**
 * The application-facing API. One implementation talks to `apps/api` over HTTP; the other
 * (`MockApi`) serves clearly labelled demo data so the shell works without a server.
 * Method groups follow the CONTRACTS §12 route table.
 */
export interface Api {
  readonly mode: 'mock' | 'http';
  auth: {
    me(): Promise<Me | null>;
    signIn(input: { email: string; password: string }): Promise<SignInResult>;
    verifyMfa(input: { code: string }): Promise<Me>;
    signOut(): Promise<void>;
    requestRecovery(input: { email: string }): Promise<void>;
  };
  teams: {
    list(): Promise<Team[]>;
    get(teamId: string): Promise<Team>;
    staff(teamId: string): Promise<{ members: (StaffMembership & { user: User })[]; invites: Invite[] }>;
    invite(teamId: string, input: { email: string; role: Role; unit: Unit | null }): Promise<Invite>;
    updateMembership(
      teamId: string,
      membershipId: string,
      patch: Partial<Pick<StaffMembership, 'role' | 'units' | 'active' | 'title'>>,
    ): Promise<StaffMembership>;
    settings(teamId: string): Promise<TeamSettings>;
    updateSettings(teamId: string, patch: Partial<TeamSettings> & { expectedVersion: number }): Promise<TeamSettings>;
  };
  seasons: {
    list(teamId: string): Promise<Season[]>;
    opponents(teamId: string): Promise<Opponent[]>;
    games(teamId: string, seasonId: string): Promise<ScheduledGame[]>;
    createGame(
      teamId: string,
      seasonId: string,
      input: Pick<ScheduledGame, 'week' | 'kind' | 'opponentId' | 'location' | 'scheduledAt' | 'notes'>,
    ): Promise<ScheduledGame>;
    updateGame(
      gameId: string,
      patch: Partial<Pick<ScheduledGame, 'week' | 'kind' | 'opponentId' | 'location' | 'scheduledAt' | 'status' | 'result' | 'notes'>> & {
        expectedVersion: number;
      },
    ): Promise<ScheduledGame>;
    previewImport(teamId: string, seasonId: string, file: { name: string; text: string }): Promise<ScheduleImport>;
    applyImport(importId: string): Promise<ScheduledGame[]>;
  };
  media: {
    assets(gameId: string): Promise<MediaAsset[]>;
    createUpload(
      gameId: string,
      input: { filename: string; byteSize: number; mimeType: string; context: UploadContext },
    ): Promise<MediaAsset>;
    jobs(teamId: string): Promise<ProcessingJob[]>;
    segments(assetId: string): Promise<PlaySegment[]>;
  };
  scouting: {
    findings(teamId: string, opponentId: string, unit: Unit): Promise<ScoutingFinding[]>;
  };
  plans: {
    get(gameId: string, unit: Unit): Promise<GamePlanBundle>;
    createDraft(versionId: string): Promise<GamePlanVersion>;
    update(
      versionId: string,
      patch: { sections: GamePlanVersion['sections']; expectedVersion: number },
    ): Promise<GamePlanVersion>;
    submit(versionId: string): Promise<GamePlanVersion>;
    approve(versionId: string): Promise<GamePlanVersion>;
    comment(versionId: string, input: { sectionKey: string | null; itemId: string | null; body: string }): Promise<PlanComment>;
  };
  playbook: {
    documents(teamId: string, unit: Unit): Promise<PlaybookDocument[]>;
    versions(teamId: string, unit: Unit): Promise<PlaybookVersion[]>;
    concepts(versionId: string): Promise<Concept[]>;
    decideConcept(conceptId: string, input: { status: 'approved' | 'rejected'; expectedVersion: number }): Promise<Concept>;
  };
  personnel: {
    players(teamId: string, seasonId: string): Promise<Player[]>;
    depthChart(teamId: string, seasonId: string, unit: Unit): Promise<DepthChart | null>;
    packages(teamId: string, seasonId: string, unit: Unit): Promise<PersonnelPackage[]>;
  };
}
