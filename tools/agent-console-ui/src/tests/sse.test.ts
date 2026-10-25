import { describe, expect, it, vi } from 'vitest';
import { EventOrderer, parseEventFrame, parseHeartbeat, SseFrameParser, SseReader } from '../lib/sse';
import type { ConsoleEvent } from '../types';

const frame = (seq: number, type = 'agent.log', id = `id-${seq}`) =>
  `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ id, seq, runId: 'r', ts: '2026-10-25T12:00:00Z', type, source: 'agent', payload: { message: `m${seq}` } })}\n\n`;

describe('SseFrameParser', () => {
  it('parses id/event/data frames and heartbeat comments', () => {
    const p = new SseFrameParser();
    const frames = p.feed(`: hb 2026-10-25T12:00:00Z\n\n${frame(1)}`);
    expect(frames[0]).toEqual({ kind: 'comment', comment: 'hb 2026-10-25T12:00:00Z' });
    expect(parseHeartbeat((frames[0] as { comment: string }).comment)).toBe('2026-10-25T12:00:00Z');
    expect(frames[1]).toMatchObject({ kind: 'event', id: '1', event: 'agent.log' });
    const ev = parseEventFrame(frames[1] as Extract<ReturnType<SseFrameParser['feed']>[number], { kind: 'event' }>);
    expect(ev).toMatchObject({ id: 'id-1', seq: 1, type: 'agent.log', payload: { message: 'm1' } });
  });

  it('handles frames split across chunks, CRLF endings and multi-line data', () => {
    const p = new SseFrameParser();
    const text = `id: 7\r\nevent: lead.note\r\ndata: {"id":"a",\r\ndata: "seq":7,"type":"lead.note","payload":{}}\r\n\r\n`;
    const out = [...p.feed(text.slice(0, 10)), ...p.feed(text.slice(10, 40)), ...p.feed(text.slice(40))];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'event', id: '7', data: '{"id":"a",\n"seq":7,"type":"lead.note","payload":{}}' });
    expect(parseEventFrame(out[0] as never)?.seq).toBe(7);
  });

  it('ignores retry/unknown fields and malformed data, and flushes on end()', () => {
    const p = new SseFrameParser();
    expect(p.feed('retry: 1000\ndata: not json\n\n')).toHaveLength(1);
    expect(parseEventFrame(p.feed('data: not json\n\n')[0] as never)).toBeNull();
    expect(p.feed('id: 3\ndata: {"id":"x","seq":3,"type":"t"}')).toHaveLength(0);
    expect(p.end()).toHaveLength(1);
  });
});

describe('EventOrderer', () => {
  const ev = (seq: number, id = `id-${seq}`): ConsoleEvent => ({ id, seq, runId: 'r', ts: '', type: 't', source: 's', payload: {} });

  it('delivers in seq order on flush and suppresses duplicate ids', () => {
    const o = new EventOrderer(0);
    expect(o.push(ev(3))).toBe(true);
    expect(o.push(ev(1))).toBe(true);
    expect(o.push(ev(2))).toBe(true);
    expect(o.push(ev(2))).toBe(false); // duplicate id
    expect(o.flush().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(o.lastSeq).toBe(3);
    expect(o.push(ev(1))).toBe(false); // already seen after flush
    expect(o.flush()).toEqual([]);
  });

  it('tolerates seq gaps (per-run streams skip other runs\' rowids)', () => {
    const o = new EventOrderer(5);
    o.push(ev(9));
    o.push(ev(12));
    expect(o.flush().map((e) => e.seq)).toEqual([9, 12]);
    expect(o.lastSeq).toBe(12);
  });
});

function streamResponse(chunks: string[], opts: { status?: number; keepOpen?: boolean } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else if (!opts.keepOpen) controller.close();
    },
  });
  return new Response(body, { status: opts.status ?? 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('SseReader', () => {
  it('replays in order, dedupes, reports status, then reconnects passing the last seq and refetches', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer T');
      if (urls.length === 1) return streamResponse([frame(2) + frame(1), frame(2, 'agent.log', 'id-2'), `: hb 2026-10-25T12:00:30Z\n\n`, frame(5)]);
      return streamResponse([frame(6)], { keepOpen: true });
    });
    const delivered: number[] = [];
    const statuses: string[] = [];
    const heartbeats: string[] = [];
    const onReconnected = vi.fn();
    const reader = new SseReader({
      url: (after) => `/api/stream?runId=r&after=${after}`,
      headers: () => ({ Authorization: 'Bearer T' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvents: (evs) => delivered.push(...evs.map((e) => e.seq)),
      onStatus: (s) => statuses.push(s),
      onHeartbeat: (iso) => heartbeats.push(iso),
      onReconnected,
    });
    reader.start();
    await vi.waitFor(() => expect(delivered).toEqual([1, 2, 5]));
    expect(heartbeats).toEqual(['2026-10-25T12:00:30Z']);
    expect(urls[0]).toBe('/api/stream?runId=r&after=0');
    expect(statuses).toContain('connected');
    expect(statuses[statuses.length - 1]).toBe('reconnecting'); // stream ended → backoff
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(delivered).toEqual([1, 2, 5, 6]));
    expect(urls[1]).toBe('/api/stream?runId=r&after=5');
    expect(onReconnected).toHaveBeenCalledTimes(1);
    reader.stop();
    expect(statuses[statuses.length - 1]).toBe('disconnected');
    vi.useRealTimers();
  });

  it('stops and reports unauthorized on 401', async () => {
    const onUnauthorized = vi.fn();
    const statuses: string[] = [];
    const reader = new SseReader({
      url: () => '/api/stream',
      headers: () => ({}),
      fetchImpl: (async () => new Response('{"error":{"code":"unauthorized"}}', { status: 401 })) as unknown as typeof fetch,
      onEvents: () => undefined,
      onStatus: (s) => statuses.push(s),
      onUnauthorized,
    });
    reader.start();
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
    expect(statuses[statuses.length - 1]).toBe('disconnected');
  });
});
