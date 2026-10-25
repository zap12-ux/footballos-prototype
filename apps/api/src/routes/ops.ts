import { Hono } from 'hono';
import type { Health } from '@footballos/contracts';
import type { AppContext } from '../context.js';

export function opsRoutes(ctx: AppContext) {
  return new Hono().get('/healthz', (c) => {
    const body: Health = { ok: true, environment: ctx.config.environment, version: ctx.version, now: ctx.now().toISOString() };
    return c.json(body, 200);
  });
}
