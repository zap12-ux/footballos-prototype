import { authenticator } from 'otplib';

// RFC 6238 TOTP via otplib (SHA-1, 6 digits, 30 s step; one step of clock drift tolerated).
authenticator.options = { window: 1 };

export function newTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function totpUri(email: string, secret: string, issuer = 'FootballOS'): string {
  return authenticator.keyuri(email, issuer, secret);
}

export function verifyTotp(code: string, secret: string): boolean {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return false;
  try {
    return authenticator.check(digits, secret);
  } catch {
    return false;
  }
}

/** For tests and the demo seed output only. */
export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}
