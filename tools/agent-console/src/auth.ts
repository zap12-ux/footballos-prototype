import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { unauthorized } from './errors.js';
import type { Service } from './service.js';
import type { Agent } from './types.js';

export type Env = {
  Variables: {
    agent: Agent;
  };
};

export const ORIGIN_ALLOW_LIST = [
  'http://127.0.0.1:4800',
  'http://localhost:4800',
  'http://127.0.0.1:4801',
  'http://localhost:4801',
];

export function allowedOrigins(port: number): Set<string> {
  return new Set([...ORIGIN_ALLOW_LIST, `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

export function bearer(c: Context): string | null {
  const h = c.req.header('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1]! : null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Requests carrying an Origin header are accepted only from the allow-list (§4). */
export function originGuard(origins: Set<string>): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && !origins.has(origin)) throw unauthorized('origin not allowed');
    await next();
  };
}

export function ownerAuth(ownerToken: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c);
    if (!token || !safeEqual(token, ownerToken)) throw unauthorized();
    await next();
  };
}

/** Agent token must resolve to an agent, and that agent must be the one in the path (else 404). */
export function agentAuth(service: Service): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = bearer(c);
    if (!token) throw unauthorized();
    const agent = service.authenticateAgent(token);
    if (!agent) throw unauthorized();
    const pathAgentId = c.req.param('agentId');
    if (!pathAgentId || pathAgentId !== agent.id) return c.json({ error: { code: 'not_found', message: 'not found' } }, 404);
    c.set('agent', agent);
    await next();
  };
}
