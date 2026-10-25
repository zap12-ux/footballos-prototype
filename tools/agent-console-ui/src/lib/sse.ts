import type { ConsoleEvent, ConnectionStatus } from '../types';

/** One parsed SSE frame: either a comment (`: hb …`) or an event with optional id/event fields. */
export type SseFrame = { kind: 'comment'; comment: string } | { kind: 'event'; id?: string; event?: string; data: string };

/**
 * Incremental text/event-stream parser. Feed decoded text chunks of any size; frames are
 * emitted when their terminating blank line arrives. Handles `\n`, `\r\n` and `\r` line
 * endings, multi-line `data:` and the `: hb <iso>` heartbeat comments from CONTRACT.md §5.
 */
export class SseFrameParser {
  private buffer = '';
  private id: string | undefined;
  private event: string | undefined;
  private data: string[] = [];
  private sawField = false;

  feed(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const out: SseFrame[] = [];
    // Normalise line endings; keep an incomplete trailing line in the buffer.
    let idx: number;
    while ((idx = this.buffer.search(/\r\n|\n|\r/)) !== -1) {
      const line = this.buffer.slice(0, idx);
      const sepLen = this.buffer.startsWith('\r\n', idx) ? 2 : 1;
      this.buffer = this.buffer.slice(idx + sepLen);
      this.line(line, out);
    }
    return out;
  }

  /** Flush an unterminated final frame (stream ended without a blank line). */
  end(): SseFrame[] {
    const out: SseFrame[] = [];
    if (this.buffer) {
      this.line(this.buffer, out);
      this.buffer = '';
    }
    this.dispatch(out);
    return out;
  }

  private line(line: string, out: SseFrame[]) {
    if (line === '') {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(':')) {
      // Comments are dispatched immediately; they never carry data and heartbeats arrive alone.
      out.push({ kind: 'comment', comment: line.slice(1).replace(/^ /, '') });
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    this.sawField = true;
    switch (field) {
      case 'id':
        this.id = value;
        break;
      case 'event':
        this.event = value;
        break;
      case 'data':
        this.data.push(value);
        break;
      default:
        break; // retry: and unknown fields are ignored
    }
  }

  private dispatch(out: SseFrame[]) {
    if (this.sawField && this.data.length > 0) {
      out.push({ kind: 'event', id: this.id, event: this.event, data: this.data.join('\n') });
    }
    this.id = undefined;
    this.event = undefined;
    this.data = [];
    this.sawField = false;
  }
}

export function parseHeartbeat(comment: string): string | null {
  const m = /^hb\s+(\S+)/.exec(comment.trim());
  return m ? m[1] : null;
}

export function parseEventFrame(frame: Extract<SseFrame, { kind: 'event' }>): ConsoleEvent | null {
  try {
    const obj = JSON.parse(frame.data) as Partial<ConsoleEvent>;
    if (!obj || typeof obj !== 'object' || typeof obj.id !== 'string') return null;
    const seq = typeof obj.seq === 'number' ? obj.seq : frame.id !== undefined ? Number(frame.id) : NaN;
    if (!Number.isFinite(seq)) return null;
    return {
      id: obj.id,
      seq,
      runId: String(obj.runId ?? ''),
      ts: String(obj.ts ?? ''),
      type: String(obj.type ?? frame.event ?? ''),
      source: String(obj.source ?? ''),
      agentId: obj.agentId ?? null,
      taskId: obj.taskId ?? null,
      questionId: obj.questionId ?? null,
      responseId: obj.responseId ?? null,
      payload: (obj.payload && typeof obj.payload === 'object' ? obj.payload : {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * De-duplicates by event id and delivers in `seq` order. `seq` is a SQLite rowid shared by
 * every run, so gaps are normal on a per-run stream; events are therefore held only until
 * `flush()` (called after each network chunk) and sorted, never until a gap closes.
 */
export class EventOrderer {
  private seen = new Set<string>();
  private pending: ConsoleEvent[] = [];
  lastSeq: number;

  constructor(lastSeq = 0) {
    this.lastSeq = lastSeq;
  }

  push(event: ConsoleEvent): boolean {
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    if (this.seen.size > 20000) {
      // bound memory: forget the oldest half (ids of long-delivered events)
      const keep = [...this.seen].slice(-10000);
      this.seen = new Set(keep);
    }
    this.pending.push(event);
    return true;
  }

  flush(): ConsoleEvent[] {
    if (this.pending.length === 0) return [];
    const batch = this.pending.sort((a, b) => a.seq - b.seq);
    this.pending = [];
    this.lastSeq = Math.max(this.lastSeq, batch[batch.length - 1].seq);
    return batch;
  }
}

export interface SseReaderOptions {
  url: (afterSeq: number) => string;
  headers: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  onEvents: (events: ConsoleEvent[]) => void;
  onHeartbeat?: (serverTimeIso: string) => void;
  onStatus?: (status: ConnectionStatus, info: { lastSeq: number; attempt: number; error?: string }) => void;
  /** Called after a successful reconnect (not the first connection) so the caller can refetch the snapshot. */
  onReconnected?: () => void;
  onUnauthorized?: () => void;
  initialSeq?: number;
  /** ms without any frame (heartbeats arrive every 15 s) before the connection is considered dead. */
  idleTimeoutMs?: number;
  maxBackoffMs?: number;
}

/**
 * Streams `/api/stream` with `fetch` so the bearer header can be sent (EventSource cannot).
 * Reconnects with exponential backoff passing the last seen `seq`.
 */
export class SseReader {
  private opts: SseReaderOptions;
  private orderer: EventOrderer;
  private controller: AbortController | null = null;
  private stopped = false;
  private attempt = 0;
  private everConnected = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SseReaderOptions) {
    this.opts = opts;
    this.orderer = new EventOrderer(opts.initialSeq ?? 0);
  }

  get lastSeq() {
    return this.orderer.lastSeq;
  }

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.clearIdle();
    this.controller?.abort();
    this.controller = null;
    this.opts.onStatus?.('disconnected', { lastSeq: this.lastSeq, attempt: this.attempt });
  }

  private status(s: ConnectionStatus, error?: string) {
    this.opts.onStatus?.(s, { lastSeq: this.lastSeq, attempt: this.attempt, error });
  }

  private armIdle() {
    this.clearIdle();
    const ms = this.opts.idleTimeoutMs ?? 45_000;
    this.idleTimer = setTimeout(() => {
      this.controller?.abort();
    }, ms);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async connect() {
    if (this.stopped) return;
    const fetchImpl = this.opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.controller = new AbortController();
    this.status(this.everConnected || this.attempt > 0 ? 'reconnecting' : 'connecting');
    let failure: string | undefined;
    try {
      const res = await fetchImpl(this.opts.url(this.lastSeq), {
        headers: { ...this.opts.headers(), Accept: 'text/event-stream', 'Last-Event-ID': String(this.lastSeq) },
        cache: 'no-store',
        signal: this.controller.signal,
      });
      if (res.status === 401) {
        this.status('disconnected', 'unauthorized');
        this.opts.onUnauthorized?.();
        this.stopped = true;
        return;
      }
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      const wasReconnect = this.everConnected;
      this.everConnected = true;
      this.attempt = 0;
      this.status('connected');
      if (wasReconnect) this.opts.onReconnected?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseFrameParser();
      this.armIdle();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.armIdle();
        this.handleFrames(parser.feed(decoder.decode(value, { stream: true })));
      }
      this.handleFrames(parser.end());
      failure = 'stream ended';
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      this.clearIdle();
    }
    if (this.stopped) return;
    this.scheduleRetry(failure);
  }

  private handleFrames(frames: SseFrame[]) {
    for (const f of frames) {
      if (f.kind === 'comment') {
        const hb = parseHeartbeat(f.comment);
        if (hb) this.opts.onHeartbeat?.(hb);
        continue;
      }
      const ev = parseEventFrame(f);
      if (ev) this.orderer.push(ev);
    }
    const batch = this.orderer.flush();
    if (batch.length) this.opts.onEvents(batch);
  }

  private scheduleRetry(error?: string) {
    this.attempt += 1;
    const max = this.opts.maxBackoffMs ?? 30_000;
    const base = Math.min(max, 1000 * 2 ** Math.min(this.attempt - 1, 6));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.status(this.attempt >= 3 ? 'disconnected' : 'reconnecting', error);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}
