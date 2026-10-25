import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** URL-safe random token; shown once, stored only as a hash. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i to avoid confusion

/** Recovery code of the form `xxxx-xxxx-xxxx` (about 59 bits of entropy). */
export function newRecoveryCode(): string {
  const group = () => Array.from({ length: 4 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Hash used for recovery codes and invite/recovery tokens: keyed with the server secret. */
export function tokenHash(secret: string, token: string): string {
  return hmacHex(secret, token);
}

/** Hash of a client IP for session records: keyed, so the raw address is not recoverable from the DB. */
export function ipHash(secret: string, ip: string | null): string | null {
  if (!ip) return null;
  return hmacHex(secret, `ip:${ip}`).slice(0, 32);
}
