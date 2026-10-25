import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, type TestApp } from './helpers.js';

export const DEMO_FILM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/public/demo-film');
export const FIXTURE_CLIPS = ['play-1.mp4', 'play-2.mp4', 'play-3.mp4', 'play-4.mp4', 'play-5.mp4', 'play-6.mp4'].map((f) => path.join(DEMO_FILM_DIR, f));

export const CONTEXT = { analyzedTeam: 'opponent', analyzedUnit: 'offense', perspective: 'endzone', teamCues: 'white jerseys (demo)' } as const;

export function sha256Of(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Creates an opponent and a regular-season game for it through the API. */
export async function seedGame(t: TestApp, cookie: string, teamId: string, seasonId: string, opponentName = 'Demo Opponent') {
  const opp = await call(t, 'POST', `/api/v1/teams/${teamId}/opponents`, { name: opponentName }, cookie);
  if (opp.status !== 201) throw new Error(`opponent: ${opp.status} ${JSON.stringify(opp.body)}`);
  const game = await call(t, 'POST', `/api/v1/teams/${teamId}/seasons/${seasonId}/games`, { week: 1, opponentId: opp.body.id, location: 'home' }, cookie);
  if (game.status !== 201) throw new Error(`game: ${game.status} ${JSON.stringify(game.body)}`);
  return { opponentId: opp.body.id as string, gameId: game.body.id as string };
}

export async function putChunk(t: TestApp, cookie: string, uploadId: string, buf: Buffer, start: number, total: number) {
  const res = await t.app.request(`/api/v1/uploads/${uploadId}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/octet-stream', 'content-range': `bytes ${start}-${start + buf.length - 1}/${total}`, 'content-length': String(buf.length) },
    body: new Uint8Array(buf),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Full §14.1 flow: create, PUT contiguous chunks, complete. Returns the complete response body. */
export async function uploadFile(t: TestApp, cookie: string, gameId: string, file: string, opts: { chunkSize?: number; withHash?: boolean; context?: typeof CONTEXT } = {}) {
  const bytes = fs.readFileSync(file);
  const chunkSize = opts.chunkSize ?? 1_000_000;
  const create = await call(t, 'POST', `/api/v1/games/${gameId}/uploads`, {
    filename: path.basename(file), byteSize: bytes.length, mimeType: 'video/mp4', ...(opts.withHash ? { sha256: sha256Of(file) } : {}), context: opts.context ?? CONTEXT,
  }, cookie);
  if (create.status !== 201) return { create, complete: null as any, chunks: [] as number[] };
  const uploadId = create.body.upload.id as string;
  const chunks: number[] = [];
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const r = await putChunk(t, cookie, uploadId, bytes.subarray(start, Math.min(bytes.length, start + chunkSize)), start, bytes.length);
    if (r.status !== 200) throw new Error(`chunk at ${start}: ${r.status} ${JSON.stringify(r.body)}`);
    chunks.push(r.body.receivedBytes);
  }
  const complete = await call(t, 'POST', `/api/v1/uploads/${uploadId}/complete`, {}, cookie);
  return { create, complete, chunks, uploadId };
}
