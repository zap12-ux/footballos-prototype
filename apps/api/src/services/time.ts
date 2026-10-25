/** Offset (ms) of an IANA time zone at a given instant, computed with Intl only. */
export function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Converts a wall-clock date/time in `timeZone` to an ISO UTC timestamp. */
export function zonedToUtcIso(date: { y: number; m: number; d: number }, time: { h: number; min: number }, timeZone: string): string {
  const guess = Date.UTC(date.y, date.m - 1, date.d, time.h, time.min, 0);
  let offset = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - offset;
  const offset2 = tzOffsetMs(timeZone, new Date(utc));
  if (offset2 !== offset) utc = guess - offset2;
  return new Date(utc).toISOString();
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Accepts `YYYY-MM-DD`, `M/D/YYYY`, `M/D/YY`, `YYYY/MM/DD`. Returns null when unparseable. */
export function parseDateCell(raw: string): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return check(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return check(y, Number(m[1]), Number(m[2]));
  }
  return null;
}

function check(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Accepts `HH:MM`, `H:MM`, `7 PM`, `7:30pm`, `19:00:00`. Returns null when unparseable. */
export function parseTimeCell(raw: string): { h: number; min: number } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) return null;
  return { h, min };
}
