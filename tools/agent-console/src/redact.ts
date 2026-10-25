const PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9]{10,}/g,
  /Bearer [A-Za-z0-9._-]{10,}/g,
  /AKIA[0-9A-Z]{12,}/g,
];

/** Replace common secret shapes in free text with "[redacted]". */
export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/** Recursively redact every string in a JSON-like value (objects, arrays, strings). */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
