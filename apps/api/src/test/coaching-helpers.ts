import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { call, type TestApp } from './helpers.js';
import { putChunk } from './media-helpers.js';

/** A small text PDF (generated in the test, never committed): headings, a numbered play list and a Terms page. */
export async function makePlaybookPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages: string[][] = [
    ['Inside Zone Right', 'Base run from 11 personnel. Read the backside end.', '1. Power Right', '2. Counter Left', '3. Duo'],
    ['Smash Concept', 'Hitch and corner against cover two.', '4. Mesh', '5. Four Verts'],
    ['Terms', 'Rip — motion toward strength', 'Liz: motion toward the left', 'Alert — change the play at the line'],
  ];
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (const line of lines) {
      page.drawText(line, { x: 72, y, size: line === lines[0] ? 20 : 12, font });
      y -= 28;
    }
  }
  return Buffer.from(await doc.save());
}

export const PLAYBOOK_TXT = [
  'Outside Zone Left',
  'Stretch run to the field; the back presses the edge.',
  '1. Trap Right',
  '2. Boot Pass',
  '',
  'Terms',
  'Trips — three receivers to one side',
  'Gun: quarterback five yards deep',
].join('\n');

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** §15.1 document intake: create at team level, PUT chunks, complete. */
export async function uploadDocument(t: TestApp, cookie: string, teamId: string, filename: string, bytes: Buffer, unit = 'offense', opts: { title?: string; chunkSize?: number } = {}) {
  const mimeType = filename.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
  const create = await call(t, 'POST', `/api/v1/teams/${teamId}/playbook/documents`, { filename, byteSize: bytes.length, mimeType, unit, ...(opts.title ? { title: opts.title } : {}) }, cookie);
  if (create.status !== 201) return { create, complete: null as any };
  const uploadId = create.body.upload.id as string;
  const chunkSize = opts.chunkSize ?? 64_000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const r = await putChunk(t, cookie, uploadId, bytes.subarray(start, Math.min(bytes.length, start + chunkSize)), start, bytes.length);
    if (r.status !== 200) throw new Error(`chunk at ${start}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const complete = await call(t, 'POST', `/api/v1/uploads/${uploadId}/complete`, {}, cookie);
  return { create, complete, uploadId };
}

import { labels, mediaAssets, playSegments } from '../db/schema.js';
import { seedUser, addStaff, signIn } from './helpers.js';

/**
 * Opponent film with coach-reviewed labels, inserted directly (no ffmpeg): one `ready` asset of the
 * opponent's offense and `n` accepted segments, all from "trips", `runs` of them labeled run and the
 * rest pass. Enough for `formation_frequency` and `play_type_by_formation` findings on the
 * reviewed-only basis.
 */
export function seedOpponentFilm(t: TestApp, teamId: string, gameId: string, userId: string, opts: { n?: number; runs?: number } = {}) {
  const n = opts.n ?? 6;
  const runs = opts.runs ?? 5;
  const nowIso = t.clock.now.toISOString();
  const assetId = crypto.randomUUID();
  t.ctx.db.insert(mediaAssets).values({
    id: assetId, teamId, gameId, uploadedBy: userId, kind: 'game_film', originalFilename: 'opp-offense.mp4', byteSize: 1000, sha256: 'b'.repeat(64), mimeType: 'video/mp4', durationSec: 600,
    width: 1280, height: 720, fps: 30, container: 'mp4', status: 'ready', rejectionReason: null, context: { analyzedTeam: 'opponent', analyzedUnit: 'offense', perspective: 'endzone', teamCues: null },
    quality: null, storageKey: `media/${teamId}/${assetId}/original.mp4`, proxyStorageKey: null, thumbnailSheetKey: null, retentionUntil: null, createdAt: nowIso, updatedAt: nowIso,
  }).run();
  const segmentIds: string[] = [];
  const labelIds: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const segId = crypto.randomUUID();
    segmentIds.push(segId);
    t.ctx.db.insert(playSegments).values({ id: segId, teamId, assetId, gameId, index: i, startSec: i * 20, endSec: i * 20 + 8, origin: 'coach_created', reviewStatus: 'accepted', supersededBy: [], version: 1, createdAt: nowIso, updatedAt: nowIso }).run();
    const values: Record<string, string> = { unit: 'offense', formation_family: 'trips', play_type: i < runs ? 'run' : 'pass' };
    const ids: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      const id = crypto.randomUUID();
      ids[key] = id;
      t.ctx.db.insert(labels).values({ id, teamId, segmentId: segId, key, inferred: null, accepted: { value, status: 'accepted', byUserId: userId, at: nowIso }, provenanceId: null, version: 1, createdAt: nowIso, updatedAt: nowIso }).run();
    }
    labelIds.push(ids);
  }
  return { assetId, segmentIds, labelIds };
}

/** A defensive coordinator (MFA) signed in, since the shared fixture's coordinator owns the offense. */
export async function addDefensiveCoordinator(t: TestApp, teamId: string, tag: string) {
  const dc = await seedUser(t, `dc@${tag}.test`, { mfa: true });
  addStaff(t, teamId, dc.user.id, 'coordinator', ['defense']);
  return { ...dc, cookie: await signIn(t, dc.user.email, dc.totpSecret) };
}
