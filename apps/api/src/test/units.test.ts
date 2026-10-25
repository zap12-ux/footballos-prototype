import { describe, expect, it } from 'vitest';
import { parseCsv } from '../services/csv.js';
import { parseDateCell, parseTimeCell, zonedToUtcIso } from '../services/time.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { RateLimiter } from '../auth/ratelimit.js';
import { redact } from '../logger.js';
import { loadConfig } from '../config.js';

describe('csv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('a,b\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('time', () => {
  it('parses dates and times', () => {
    expect(parseDateCell('2026-08-28')).toEqual({ y: 2026, m: 8, d: 28 });
    expect(parseDateCell('8/28/26')).toEqual({ y: 2026, m: 8, d: 28 });
    expect(parseDateCell('2/30/2026')).toBeNull();
    expect(parseTimeCell('7:00 PM')).toEqual({ h: 19, min: 0 });
    expect(parseTimeCell('12am')).toEqual({ h: 0, min: 0 });
    expect(parseTimeCell('19:30:00')).toEqual({ h: 19, min: 30 });
    expect(parseTimeCell('25:00')).toBeNull();
  });
  it('converts wall-clock time in a zone to UTC across DST', () => {
    expect(zonedToUtcIso({ y: 2026, m: 8, d: 28 }, { h: 19, min: 0 }, 'America/New_York')).toBe('2026-08-28T23:00:00.000Z');
    expect(zonedToUtcIso({ y: 2026, m: 11, d: 20 }, { h: 19, min: 0 }, 'America/New_York')).toBe('2026-11-21T00:00:00.000Z');
    expect(zonedToUtcIso({ y: 2026, m: 8, d: 28 }, { h: 19, min: 0 }, 'UTC')).toBe('2026-08-28T19:00:00.000Z');
  });
});

describe('password hashing (scrypt)', () => {
  it('round-trips and rejects wrong passwords or malformed hashes', async () => {
    const h = await hashPassword('correct-horse-battery-staple', { N: 1 << 12 });
    expect(h.startsWith('scrypt$4096$8$1$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery-staple', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('blocks after max hits in the window and recovers', () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, () => now);
    expect(rl.check('k')).toBeNull();
    rl.hit('k'); rl.hit('k');
    expect(rl.check('k')).toBe(1);
    now = 1001;
    expect(rl.check('k')).toBeNull();
  });
});

describe('config and logging', () => {
  it('production refuses to start without SESSION_SECRET; development falls back', () => {
    expect(() => loadConfig({ FOOTBALLOS_ENV: 'production', FOOTBALLOS_DATA_DIR: '/tmp/x' })).toThrow(/SESSION_SECRET/);
    const dev = loadConfig({ FOOTBALLOS_ENV: 'research', FOOTBALLOS_DATA_DIR: '/tmp/x' });
    expect(dev.environment).toBe('research');
    expect(dev.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(loadConfig({ COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
    expect(() => loadConfig({ FOOTBALLOS_ENV: 'staging' })).toThrow(/FOOTBALLOS_ENV/);
  });
  it('log redaction hides credential-like fields', () => {
    expect(redact({ password: 'x', nested: { apiKey: 'y', ok: 1 }, unredacted_recovery_token: 'shown' })).toEqual({ password: '[redacted]', nested: { apiKey: '[redacted]', ok: 1 }, unredacted_recovery_token: 'shown' });
  });
});
