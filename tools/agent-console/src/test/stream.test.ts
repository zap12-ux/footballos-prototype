import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OWNER, ask, listen, makeHarness, seed, type Harness } from './helpers.js';

let h: Harness;
let srv: Awaited<ReturnType<typeof listen>>;
beforeEach(async () => {
  h = makeHarness({ heartbeatMs: 200 });
  srv = await listen(h);
});
afterEach(async () => {
  await srv.close();
  h.close();
});

interface Frame {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

/** Read SSE frames until `until(frames)` is true or the timeout elapses. */
async function readFrames(res: Response, until: (frames: Frame[]) => boolean, timeoutMs = 5000): Promise<Frame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !until(frames)) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now())),
    ]);
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const f: Frame = {};
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) f.comment = line.slice(1).trim();
        else if (line.startsWith('id:')) f.id = line.slice(3).trim();
        else if (line.startsWith('event:')) f.event = line.slice(6).trim();
        else if (line.startsWith('data:')) f.data = (f.data ? f.data + '\n' : '') + line.slice(5).trim();
      }
      frames.push(f);
    }
  }
  await reader.cancel().catch(() => undefined);
  return frames;
}

describe('SSE stream', () => {
  it('replays events after a seq in order without duplicates, then streams live, with heartbeats', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const all = h.service.eventsAfter(s.run.id, 0);
    const cut = all[2]!.seq;
    const expectedReplay = all.filter((e) => e.seq > cut).map((e) => e.seq);

    const res = await fetch(`${srv.url}/api/stream?runId=${s.run.id}&after=${cut}`, {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Create a live event while the stream is open.
    setTimeout(() => {
      void h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    }, 100);

    const frames = await readFrames(
      res,
      (fs) => fs.some((f) => f.event === 'response.submitted') && fs.some((f) => f.comment?.startsWith('hb ')),
    );
    const dataFrames = frames.filter((f) => f.data);
    const seqs = dataFrames.map((f) => Number(f.id));
    expect(seqs.slice(0, expectedReplay.length)).toEqual(expectedReplay);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    const last = JSON.parse(dataFrames[dataFrames.length - 1]!.data!);
    expect(last.type).toBe('response.submitted');
    expect(last.seq).toBe(seqs[seqs.length - 1]);
    expect(last).toMatchObject({ runId: s.run.id, source: 'owner', questionId: q.id });
    expect(dataFrames[dataFrames.length - 1]!.event).toBe('response.submitted');
    expect(frames.some((f) => f.comment && /^hb \d{4}-\d{2}-\d{2}T/.test(f.comment))).toBe(true);
  });

  it('honours Last-Event-ID and requires the owner token', async () => {
    const s = await seed(h);
    const all = h.service.eventsAfter(s.run.id, 0);
    const unauth = await fetch(`${srv.url}/api/stream?runId=${s.run.id}`);
    expect(unauth.status).toBe(401);
    const res = await fetch(`${srv.url}/api/stream?runId=${s.run.id}`, {
      headers: { authorization: `Bearer ${OWNER}`, 'last-event-id': String(all[all.length - 2]!.seq) },
    });
    const frames = await readFrames(res, (fs) => fs.some((f) => f.comment?.startsWith('hb ')));
    const seqs = frames.filter((f) => f.data).map((f) => Number(f.id));
    expect(seqs).toEqual([all[all.length - 1]!.seq]);
  });
});

describe('agent long-poll', () => {
  it('returns 204 after the wait when nothing arrives and 200 as soon as an answer is submitted', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const headers = { authorization: `Bearer ${s.tok1}` };
    const t0 = Date.now();
    const empty = await fetch(`${srv.url}/api/agent/${s.a1.id}/questions/${q.id}/response?wait=1`, { headers });
    expect(empty.status).toBe(204);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);

    const pending = fetch(`${srv.url}/api/agent/${s.a1.id}/questions/${q.id}/response?wait=10`, { headers });
    setTimeout(() => {
      void h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, text: 'go with a' });
    }, 150);
    const t1 = Date.now();
    const got = await pending;
    expect(got.status).toBe(200);
    expect(Date.now() - t1).toBeLessThan(5000);
    const body = await got.json();
    expect(body.response.text).toBe('go with a');
    expect(body.response.state).toBe('delivered');
    const tooLong = await fetch(`${srv.url}/api/agent/${s.a1.id}/questions/${q.id}/response?wait=31`, { headers });
    expect(tooLong.status).toBe(400);
  });

  it('wakes a waiting agent with 410 when its question is superseded', async () => {
    const s = await seed(h);
    const q1 = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const headers = { authorization: `Bearer ${s.tok1}` };
    const pending = fetch(`${srv.url}/api/agent/${s.a1.id}/questions/${q1.id}/response?wait=10`, { headers });
    setTimeout(() => void ask(h, s.tok1, s.a1.id, s.t1.id, { supersedesQuestionId: q1.id }), 150);
    const t = Date.now();
    const res = await pending;
    expect(res.status).toBe(410);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
