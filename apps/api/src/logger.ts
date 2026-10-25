export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEY = /(password|secret|token|cookie|authorization|apikey|api_key|hash)/i;

export type Logger = {
  level: LogLevel;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  child: (fields: Record<string, unknown>) => Logger;
};

/** Redacts any field whose key looks like a credential. Values are never inspected for content. */
export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY.test(k) && !/^(allow|unredacted)_/.test(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error)) out[k] = redact(v as Record<string, unknown>);
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

export function createLogger(level: LogLevel, base: Record<string, unknown> = {}, write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    write(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...redact({ ...base, ...(fields ?? {}) }) }));
  };
  return {
    level,
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, write),
  };
}
