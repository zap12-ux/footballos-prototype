import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { schemas } from '../index.js';
import { fixtures, ID, NOW } from './fixtures.js';

type Case = { schema: z.ZodTypeAny; valid: unknown; invalid: unknown; why: string };

const cases: Record<string, Case> = {
  Team: { schema: schemas.TeamSchema, valid: fixtures.Team, invalid: { ...fixtures.Team, environmentKind: 'prod' }, why: 'unknown environmentKind' },
  Season: { schema: schemas.SeasonSchema, valid: fixtures.Season, invalid: { ...fixtures.Season, startsOn: '08/01/2026' }, why: 'date not YYYY-MM-DD' },
  Opponent: { schema: schemas.OpponentSchema, valid: fixtures.Opponent, invalid: { ...fixtures.Opponent, name: '' }, why: 'empty name' },
  ScheduledGame: { schema: schemas.ScheduledGameSchema, valid: fixtures.ScheduledGame, invalid: { ...fixtures.ScheduledGame, result: { ourScore: 7, theirScore: 14, outcome: 'win' } }, why: 'outcome disagrees with scores' },
  GameWorkspace: { schema: schemas.GameWorkspaceSchema, valid: fixtures.GameWorkspace, invalid: { ...fixtures.GameWorkspace, gameId: 'game-1' }, why: 'non-uuid id' },
  ScheduleImport: { schema: schemas.ScheduleImportSchema, valid: fixtures.ScheduleImport, invalid: { ...fixtures.ScheduleImport, mapping: { Week: 'weak' } }, why: 'unknown mapping target' },
  Invite: { schema: schemas.InviteSchema, valid: fixtures.Invite, invalid: { ...fixtures.Invite, role: 'owner' }, why: 'unknown role' },
  User: { schema: schemas.UserSchema, valid: fixtures.User, invalid: { ...fixtures.User, email: 'not-an-email' }, why: 'bad email' },
  Session: { schema: schemas.SessionSchema, valid: fixtures.Session, invalid: { ...fixtures.Session, mfaVerified: 'yes' }, why: 'non-boolean mfaVerified' },
  StaffMembership: { schema: schemas.StaffMembershipSchema, valid: fixtures.StaffMembership, invalid: { ...fixtures.StaffMembership, units: ['kicking'] }, why: 'unknown unit' },
  AuditEvent: { schema: schemas.AuditEventSchema, valid: fixtures.AuditEvent, invalid: { ...fixtures.AuditEvent, at: '2026-10-25' }, why: 'date without time' },
  MediaAsset: { schema: schemas.MediaAssetSchema, valid: fixtures.MediaAsset, invalid: { ...fixtures.MediaAsset, sha256: 'xyz' }, why: 'sha256 not hex-64' },
  Upload: { schema: schemas.UploadSchema, valid: fixtures.Upload, invalid: { ...fixtures.Upload, totalBytes: 0 }, why: 'zero total bytes' },
  ProcessingJob: { schema: schemas.ProcessingJobSchema, valid: fixtures.ProcessingJob, invalid: { ...fixtures.ProcessingJob, status: 'done' }, why: 'unknown status' },
  PlaySegment: { schema: schemas.PlaySegmentSchema, valid: fixtures.PlaySegment, invalid: { ...fixtures.PlaySegment, endSec: 5 }, why: 'endSec before startSec' },
  Label: { schema: schemas.LabelSchema, valid: fixtures.Label, invalid: { ...fixtures.Label, inferred: { ...fixtures.Label.inferred, abstained: true, value: 'run' } }, why: 'abstention with a value' },
  LabelRevision: { schema: schemas.LabelRevisionSchema, valid: fixtures.LabelRevision, invalid: { ...fixtures.LabelRevision, newStatus: 'guessed' }, why: 'unknown status' },
  ModelProvenance: { schema: schemas.ModelProvenanceSchema, valid: fixtures.ModelProvenance, invalid: { ...fixtures.ModelProvenance, inputTokens: 1.5 }, why: 'fractional token count' },
  ScoutingFinding: { schema: schemas.ScoutingFindingSchema, valid: fixtures.ScoutingFinding, invalid: { ...fixtures.ScoutingFinding, numerator: 30 }, why: 'numerator above denominator' },
  ReportSnapshot: { schema: schemas.ReportSnapshotSchema, valid: fixtures.ReportSnapshot, invalid: { ...fixtures.ReportSnapshot, title: '' }, why: 'empty title' },
  PlaybookDocument: { schema: schemas.PlaybookDocumentSchema, valid: fixtures.PlaybookDocument, invalid: { ...fixtures.PlaybookDocument, pageCount: -1 }, why: 'negative page count' },
  PlaybookPage: { schema: schemas.PlaybookPageSchema, valid: fixtures.PlaybookPage, invalid: { ...fixtures.PlaybookPage, ocrConfidence: 1.5 }, why: 'confidence above 1' },
  PlaybookVersion: { schema: schemas.PlaybookVersionSchema, valid: fixtures.PlaybookVersion, invalid: { ...fixtures.PlaybookVersion, status: 'live' }, why: 'unknown status' },
  Concept: { schema: schemas.ConceptSchema, valid: fixtures.Concept, invalid: { ...fixtures.Concept, sources: [{ documentId: ID.document, pageNumber: 0, bbox: null, excerpt: null }] }, why: 'page 0' },
  Term: { schema: schemas.TermSchema, valid: fixtures.Term, invalid: { ...fixtures.Term, term: '' }, why: 'empty term' },
  Player: { schema: schemas.PlayerSchema, valid: fixtures.Player, invalid: { ...fixtures.Player, status: 'benched' }, why: 'unknown status' },
  DepthChart: { schema: schemas.DepthChartSchema, valid: fixtures.DepthChart, invalid: { ...fixtures.DepthChart, slots: [{ position: 'QB', order: 0, playerId: ID.player }] }, why: 'order 0' },
  PersonnelPackage: { schema: schemas.PersonnelPackageSchema, valid: fixtures.PersonnelPackage, invalid: { ...fixtures.PersonnelPackage, playerIds: ['7'] }, why: 'non-uuid player id' },
  Recommendation: { schema: schemas.RecommendationSchema, valid: fixtures.Recommendation, invalid: { ...fixtures.Recommendation, status: 'stale', staleReason: null }, why: 'stale without reason' },
  GamePlan: { schema: schemas.GamePlanSchema, valid: fixtures.GamePlan, invalid: { ...fixtures.GamePlan, unit: 'kicking' }, why: 'unknown unit' },
  GamePlanVersion: { schema: schemas.GamePlanVersionSchema, valid: fixtures.GamePlanVersion, invalid: { ...fixtures.GamePlanVersion, sections: [{ key: 'trick_plays', title: 'x', items: [] }] }, why: 'unknown section key' },
  PlanComment: { schema: schemas.PlanCommentSchema, valid: fixtures.PlanComment, invalid: { ...fixtures.PlanComment, body: '' }, why: 'empty body' },
  ReviewFlag: { schema: schemas.ReviewFlagSchema, valid: { kind: 'stale_recommendation', message: 'Recommendation inputs changed', versionId: ID.planVersion, itemId: ID.item, since: NOW }, invalid: { kind: 'weather', message: 'x', versionId: ID.planVersion, itemId: null, since: NOW }, why: 'unknown flag kind' },
  RosterImportRow: { schema: schemas.RosterImportRowSchema, valid: { row: 1, jersey: '7', firstName: 'Demo', lastName: 'Player', positions: ['QB'], classYear: 'JR', status: 'active', notes: '', matchesPlayerId: null }, invalid: { row: 1, jersey: '7', firstName: '', lastName: 'Player', positions: [], classYear: '', status: 'active', notes: '', matchesPlayerId: null }, why: 'empty first name' },
  ShareLink: { schema: schemas.ShareLinkSchema, valid: fixtures.ShareLink, invalid: { ...fixtures.ShareLink, targetType: 'asset' }, why: 'unknown target type' },
};

describe('record schemas', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name} accepts a valid fixture`, () => {
      const r = c.schema.safeParse(c.valid);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    });
    it(`${name} rejects ${c.why}`, () => {
      expect(c.schema.safeParse(c.invalid).success).toBe(false);
    });
  }
});

describe('conventions', () => {
  it('timestamps need millisecond precision and Z', () => {
    expect(schemas.TimestampSchema.safeParse(NOW).success).toBe(true);
    expect(schemas.TimestampSchema.safeParse('2026-10-25T16:04:12Z').success).toBe(false);
    expect(schemas.TimestampSchema.safeParse('2026-10-25T16:04:12.345+02:00').success).toBe(false);
  });
  it('ids are UUIDs', () => {
    expect(schemas.IdSchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(schemas.IdSchema.safeParse('abc').success).toBe(false);
  });
  it('pagination defaults to 50 and caps at 200', () => {
    expect(schemas.PaginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(schemas.PaginationQuerySchema.parse({ limit: '10', cursor: 'x' })).toEqual({ limit: 10, cursor: 'x' });
    expect(schemas.PaginationQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    const page = schemas.paginated(schemas.TeamSchema);
    expect(page.safeParse({ items: [fixtures.Team], nextCursor: null }).success).toBe(true);
    expect(page.safeParse({ items: [fixtures.Team] }).success).toBe(false);
  });
  it('error envelope', () => {
    const ok = { error: { code: 'conflict', message: 'Plan version 4 expected, current is 5', details: { currentVersion: 5 } } };
    expect(schemas.ErrorEnvelopeSchema.safeParse(ok).success).toBe(true);
    expect(schemas.ErrorEnvelopeSchema.safeParse({ error: { code: 'oops', message: 'x' } }).success).toBe(false);
    expect(schemas.ERROR_STATUS.conflict).toBe(409);
    expect(schemas.ERROR_STATUS.rate_limited).toBe(429);
  });
  it('costUsd allows at most 6 decimals', () => {
    expect(schemas.CostUsdSchema.safeParse(0.123456).success).toBe(true);
    expect(schemas.CostUsdSchema.safeParse(0.1234567).success).toBe(false);
  });
  it('enum spelling is snake_case', () => {
    const enums = [schemas.RoleSchema, schemas.UnitSchema, schemas.GameStatusSchema, schemas.JobKindSchema, schemas.LabelKeySchema, schemas.OffenseSectionKeySchema, schemas.AuditActionSchema];
    for (const e of enums) for (const v of e.options) expect(v).toMatch(/^[a-z0-9_.]+$/);
  });
});

describe('request schemas', () => {
  it('sign-in lowercases email', () => {
    expect(schemas.SignInRequestSchema.parse({ email: 'HC@Example.test', password: 'x' }).email).toBe('hc@example.test');
  });
  it('patch game requires expectedVersion', () => {
    expect(schemas.PatchGameRequestSchema.safeParse({ status: 'final' }).success).toBe(false);
    expect(schemas.PatchGameRequestSchema.safeParse({ expectedVersion: 1, status: 'final' }).success).toBe(true);
  });
  it('create season rejects inverted dates', () => {
    expect(schemas.CreateSeasonRequestSchema.safeParse({ label: '2026', startsOn: '2026-12-01', endsOn: '2026-08-01' }).success).toBe(false);
  });
  it('share links are capped at 72 hours and default to 72 (owner decision 2026-10-25)', () => {
    expect(schemas.SHARE_LINK_MAX_HOURS).toBe(72);
    expect(schemas.CreateShareLinkRequestSchema.parse({})).toEqual({ expiresInHours: 72 });
    expect(schemas.CreateShareLinkRequestSchema.safeParse({ expiresInHours: 73 }).success).toBe(false);
    expect(schemas.CreateShareLinkRequestSchema.safeParse({ expiresInHours: 168 }).success).toBe(false);
    expect(schemas.CreateShareLinkRequestSchema.parse({ expiresInHours: 1 })).toEqual({ expiresInHours: 1 });
  });
  it('document uploads need a unit and no context; film uploads need a context (§15.1)', () => {
    const base = { filename: 'install.pdf', byteSize: 10, mimeType: 'application/pdf' };
    expect(schemas.CreateUploadRequestSchema.safeParse({ ...base, kind: 'document' }).success).toBe(false);
    expect(schemas.CreateUploadRequestSchema.safeParse({ ...base, kind: 'document', unit: 'offense' }).success).toBe(true);
    expect(schemas.CreateUploadRequestSchema.safeParse({ ...base }).success).toBe(false);
  });
  it('an edit decision needs editedStatement (§15.3)', () => {
    expect(schemas.RecommendationDecisionRequestSchema.safeParse({ decision: 'edit' }).success).toBe(false);
    expect(schemas.RecommendationDecisionRequestSchema.safeParse({ decision: 'edit', editedStatement: 'Run it from 12' }).success).toBe(true);
    expect(schemas.RecommendationDecisionRequestSchema.safeParse({ decision: 'accept' }).success).toBe(true);
  });
  it('error status map includes gone → 410', () => {
    expect(schemas.ERROR_STATUS.gone).toBe(410);
  });
  it('upload filename is sanitized on intake (§14.10, QA D-7)', () => {
    const { sanitizeFilename, UploadFilenameSchema } = schemas;
    expect(sanitizeFilename('play-1.mp4')).toBe('play-1.mp4');
    expect(sanitizeFilename('  spaced name.MOV ')).toBe('spaced name.MOV');
    expect(sanitizeFilename('a\u0007b\u001b[31m.mp4\u007f')).toBe('ab[31m.mp4'); // control characters stripped
    expect(sanitizeFilename('../../../../tmp/escape.mp4')).toBe('../../../../tmp/escape.mp4'); // path-like names are display names only
    expect(sanitizeFilename('a\u0000b.mp4')).toBeNull(); // NUL is rejected, not stripped
    expect(sanitizeFilename('.mp4')).toBeNull(); // no stem
    expect(sanitizeFilename('..mp4')).toBeNull();
    expect(sanitizeFilename('')).toBeNull();
    expect(sanitizeFilename('\u0001\u0002')).toBeNull(); // empty after cleaning
    expect(sanitizeFilename(`${'x'.repeat(251)}.mp4`)).toBe(`${'x'.repeat(251)}.mp4`); // exactly 255
    expect(sanitizeFilename(`${'x'.repeat(252)}.mp4`)).toBeNull(); // 256
    expect(UploadFilenameSchema.parse('a\u0007b.mp4')).toBe('ab.mp4');
    for (const bad of ['a\u0000b.mp4', '.mp4', '', `${'x'.repeat(252)}.mp4`]) {
      expect(UploadFilenameSchema.safeParse(bad).success).toBe(false);
    }
    const req = schemas.CreateUploadRequestSchema.safeParse({ filename: 'a\u0000b.mp4', byteSize: 10, mimeType: 'video/mp4', context: { analyzedTeam: 'us', analyzedUnit: 'offense', perspective: 'endzone', teamCues: null } });
    expect(req.success).toBe(false);
  });
});
