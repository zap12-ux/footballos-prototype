import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ZodType } from 'zod';
import { agentAuth, allowedOrigins, originGuard, ownerAuth, type Env } from './auth.js';
import { ApiError, validation } from './errors.js';
import { GitInfoCache } from './git.js';
import * as S from './schemas.js';
import type { Service } from './service.js';
import type { ConsoleEvent } from './types.js';

export interface AppOptions {
  service: Service;
  ownerToken: string;
  port: number;
  repoRoot: string;
  uiDist: string;
  heartbeatMs?: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function parse<T>(c: { req: { json(): Promise<unknown> } }, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validation('body must be JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw validation('invalid request body', r.error.issues);
  return r.data;
}

export function createApp(opts: AppOptions) {
  const { service, ownerToken } = opts;
  const gitCache = new GitInfoCache(opts.repoRoot);
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toBody(), err.status as 400);
    console.error('[console] internal error', err instanceof Error ? err.message : err);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'not found' } }, 404));

  const api = new Hono<Env>();
  api.use('*', originGuard(allowedOrigins(opts.port)));

  // ---- owner / lead routes (§4.1) ----------------------------------------------------
  const owner = new Hono<Env>();
  owner.use('*', ownerAuth(ownerToken));

  owner.get('/state', (c) => {
    const run = service.resolveRun(c.req.query('runId'));
    return c.json(service.getState(run));
  });

  owner.get('/runs', (c) => c.json({ runs: service.listRuns() }));
  owner.post('/runs', async (c) => {
    const body = await parse(c, S.createRunSchema);
    return c.json({ run: service.createRun(body) }, 201);
  });

  owner.post('/agents', async (c) => {
    const body = await parse(c, S.registerAgentSchema);
    return c.json(service.registerAgent(body), 201);
  });
  owner.patch('/agents/:agentId', async (c) => {
    const body = await parse(c, S.patchAgentSchema);
    return c.json({ agent: service.patchAgent(c.req.param('agentId'), body) });
  });

  owner.post('/tasks', async (c) => {
    const body = await parse(c, S.createTaskSchema);
    return c.json({ task: service.createTask(body) }, 201);
  });
  owner.patch('/tasks/:taskId', async (c) => {
    const body = await parse(c, S.patchTaskSchema);
    return c.json({ task: service.patchTask(c.req.param('taskId'), body) });
  });

  owner.post('/verifications', async (c) => {
    const body = await parse(c, S.createVerificationSchema);
    return c.json({ verification: service.createVerification(body) }, 201);
  });

  owner.post('/runtime/events', async (c) => {
    const body = await parse(c, S.runtimeEventSchema);
    return c.json({ event: service.postRuntimeEvent(body) }, 201);
  });

  owner.post('/questions/:questionId/responses', async (c) => {
    const body = await parse(c, S.submitResponseSchema);
    const { response, created } = service.submitResponse(c.req.param('questionId'), body);
    return c.json({ response: service.withResumed(response) }, created ? 201 : 200);
  });

  owner.get('/questions', (c) => {
    const run = service.resolveRun(c.req.query('runId'));
    const status = c.req.query('status');
    return c.json({ run, questions: run ? service.listQuestions(run.id, status || undefined) : [] });
  });

  owner.get('/lead/inbox', (c) => {
    const run = service.resolveRun(c.req.query('runId'));
    return c.json({ run, ...service.leadInbox(run) });
  });

  owner.get('/git/agents/:agentId', async (c) => {
    const agent = service.getAgent(c.req.param('agentId'));
    if (!agent) throw new ApiError('not_found', 'agent not found');
    return c.json(await gitCache.get(agent.id, agent.branch));
  });

  owner.get('/stream', (c) => {
    const runParam = c.req.query('runId');
    const run = runParam ? service.resolveRun(runParam) : null;
    const afterRaw = c.req.query('after') ?? c.req.header('last-event-id') ?? '0';
    const after = Number.parseInt(afterRaw, 10);
    if (!Number.isFinite(after) || after < 0) throw validation('after must be a non-negative integer');
    const heartbeatMs = opts.heartbeatMs ?? 15_000;

    return streamSSE(c, async (stream) => {
      let lastSeq = after;
      const send = (ev: ConsoleEvent) =>
        stream.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) });

      // Replay first, then live. Anything that arrives during replay is queued and de-duplicated by seq.
      const queued: ConsoleEvent[] = [];
      let replaying = true;
      const onEvent = (ev: ConsoleEvent) => {
        if (run && ev.runId !== run.id) return;
        if (replaying) queued.push(ev);
        else if (ev.seq > lastSeq) {
          lastSeq = ev.seq;
          void send(ev);
        }
      };
      service.bus.on('event', onEvent);

      for (const ev of service.eventsAfter(run?.id ?? null, after)) {
        lastSeq = ev.seq;
        await send(ev);
      }
      replaying = false;
      for (const ev of queued.sort((a, b) => a.seq - b.seq)) {
        if (ev.seq > lastSeq) {
          lastSeq = ev.seq;
          await send(ev);
        }
      }
      await stream.write(`: hb ${new Date().toISOString()}\n\n`);

      let open = true;
      const hb = setInterval(() => {
        if (!open) return;
        stream.write(`: hb ${new Date().toISOString()}\n\n`).catch(() => undefined);
      }, heartbeatMs);
      const close = () => {
        open = false;
        clearInterval(hb);
        service.bus.off('event', onEvent);
      };
      // Keep the handler alive until the client disconnects.
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      close();
    });
  });

  // ---- agent routes (§4.2) ------------------------------------------------------------
  // Mounted before the owner router so the owner-token middleware (use('*')) never runs
  // for /api/agent/* paths; agent routes carry their own token check.
  const agentRoutes = new Hono<Env>();
  agentRoutes.use('/:agentId/*', agentAuth(service));

  agentRoutes.post('/:agentId/status', async (c) => {
    const body = await parse(c, S.reportStatusSchema);
    const { event, duplicate } = service.reportStatus(c.get('agent'), body);
    return c.json({ event, duplicate }, 200);
  });

  agentRoutes.post('/:agentId/questions', async (c) => {
    const body = await parse(c, S.askQuestionSchema);
    const { question, created } = service.askQuestion(c.get('agent'), body);
    return c.json({ question }, created ? 201 : 200);
  });

  agentRoutes.get('/:agentId/questions/:questionId/response', async (c) => {
    const waitRaw = c.req.query('wait');
    const wait = waitRaw === undefined ? 0 : Number(waitRaw);
    if (!Number.isFinite(wait) || wait < 0 || wait > 30) throw validation('wait must be between 0 and 30 seconds');
    const result = await service.getUserResponse(c.get('agent'), c.req.param('questionId'), wait);
    if (result.status === 204) return c.body(null, 204);
    if (result.status === 410) return c.json(result.body, 410);
    return c.json(result.body, 200);
  });

  agentRoutes.post('/:agentId/questions/:questionId/ack', async (c) => {
    const body = await parse(c, S.ackSchema);
    const { response, changed } = service.acknowledgeResponse(c.get('agent'), c.req.param('questionId'), body);
    return c.json({ response, changed }, 200);
  });

  agentRoutes.post('/:agentId/tasks/:taskId/result', async (c) => {
    const body = await parse(c, S.taskResultSchema);
    const { result, task, duplicate } = service.reportTaskResult(c.get('agent'), c.req.param('taskId'), body);
    return c.json({ result, task, duplicate }, duplicate ? 200 : 201);
  });

  agentRoutes.post('/:agentId/log', async (c) => {
    const body = await parse(c, S.logSchema);
    const { event, duplicate } = service.log(c.get('agent'), body);
    return c.json({ event, duplicate }, 200);
  });

  api.route('/agent', agentRoutes);
  api.route('/', owner);
  app.route('/api', api);

  app.get('/healthz', (c) => c.json({ ok: true, serverTime: new Date().toISOString() }));

  // ---- static UI ----------------------------------------------------------------------
  const uiDist = path.resolve(opts.uiDist);
  const indexHtml = path.join(uiDist, 'index.html');
  app.get('/*', async (c) => {
    if (!fs.existsSync(indexHtml)) {
      return c.text(
        [
          'Agent Build Console API is running, but the UI is not built.',
          '',
          `Expected: ${indexHtml}`,
          'Build it with:  npm run build -w tools/agent-console-ui',
          'Or start everything with:  npm run console   (from the repo root)',
          '',
          'API: GET /api/state (owner token required). Health: GET /healthz',
        ].join('\n'),
        200,
      );
    }
    const reqPath = decodeURIComponent(new URL(c.req.url).pathname);
    const candidate = path.resolve(uiDist, '.' + reqPath);
    if (candidate.startsWith(uiDist + path.sep) || candidate === uiDist) {
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) {
          const ext = path.extname(candidate).toLowerCase();
          return c.body(fs.readFileSync(candidate), 200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        }
      } catch {
        // fall through to SPA index
      }
    }
    return c.html(fs.readFileSync(indexHtml, 'utf8'));
  });

  return app;
}
