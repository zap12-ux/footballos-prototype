import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ErrorEnvelope } from '@footballos/contracts';
import { ApiError } from './errors.js';
import type { AppContext } from './context.js';
import { authRoutes } from './routes/auth.js';
import { teamRoutes } from './routes/teams.js';
import { scheduleRoutes } from './routes/schedule.js';
import { opsRoutes } from './routes/ops.js';
import { mediaRoutes, mediaStreamRoutes } from './routes/media.js';
import { jobRoutes } from './routes/jobs.js';
import { segmentRoutes } from './routes/segments.js';
import { labelRoutes } from './routes/labels.js';
import { scoutingRoutes } from './routes/scouting.js';
import { settingsRoutes } from './routes/settings.js';

import { API_PREFIX } from './http/prefix.js';
export { API_PREFIX };

/**
 * Builds the HTTP application. Route modules are chained so `hono/client` can derive a typed client
 * from `AppType` (the web app imports it type-only).
 */
export function createApp(ctx: AppContext) {
  const app = new Hono()
    .onError((err, c) => {
      if (err instanceof ApiError) {
        if (err.status >= 500) ctx.logger.error('request failed', { code: err.code, path: c.req.path });
        return c.json(err.toEnvelope(), err.status);
      }
      if (err instanceof HTTPException) {
        const body: ErrorEnvelope = { error: { code: err.status === 413 ? 'payload_too_large' : err.status === 404 ? 'not_found' : err.status === 401 ? 'unauthorized' : 'validation_error', message: err.message || 'Request rejected' } };
        return c.json(body, err.status);
      }
      ctx.logger.error('unhandled error', { path: c.req.path, method: c.req.method, error: err });
      const body: ErrorEnvelope = { error: { code: 'internal', message: 'Internal error' } };
      return c.json(body, 500);
    })
    .notFound((c) => {
      const body: ErrorEnvelope = { error: { code: 'not_found', message: `No route for ${c.req.method} ${c.req.path}` } };
      return c.json(body, 404);
    })
    .use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'same-origin');
      await next();
    })
    .route('/', opsRoutes(ctx))
    .route(`${API_PREFIX}/auth`, authRoutes(ctx))
    .route(API_PREFIX, teamRoutes(ctx))
    .route(API_PREFIX, scheduleRoutes(ctx))
    .route(API_PREFIX, mediaStreamRoutes(ctx))
    .route(API_PREFIX, mediaRoutes(ctx))
    .route(API_PREFIX, jobRoutes(ctx))
    .route(API_PREFIX, segmentRoutes(ctx))
    .route(API_PREFIX, labelRoutes(ctx))
    .route(API_PREFIX, scoutingRoutes(ctx))
    .route(API_PREFIX, settingsRoutes(ctx));
  return app;
}

export type AppType = ReturnType<typeof createApp>;
