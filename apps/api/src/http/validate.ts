import type { Env, MiddlewareHandler, ValidationTargets } from 'hono';
import { validator } from 'hono/validator';
import type { z } from 'zod';
import { ApiError } from '../errors.js';

type Target = keyof ValidationTargets;

/**
 * zod validation middleware built on `hono/validator`, typed so `c.req.valid(target)` returns the
 * parsed output and the `hono/client` sees the schema's input type. Failures throw the standard
 * `validation_error` envelope with `details.issues`.
 */
export function zv<
  T extends z.ZodType,
  Tg extends Target,
  E extends Env = Env,
  P extends string = string,
  In = z.input<T>,
  Out = z.output<T>,
  V extends { in: { [K in Tg]: In }; out: { [K in Tg]: Out } } = { in: { [K in Tg]: In }; out: { [K in Tg]: Out } },
>(target: Tg, schema: T): MiddlewareHandler<E, P, V> {
  return validator(target, (value) => {
    const r = schema.safeParse(value);
    if (!r.success) {
      throw new ApiError('validation_error', `Invalid ${target}`, {
        issues: r.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      });
    }
    return r.data as Out;
  }) as unknown as MiddlewareHandler<E, P, V>;
}
