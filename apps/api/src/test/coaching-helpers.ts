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
