import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { accessSync, constants } from 'node:fs';

const require = createRequire(import.meta.url);

/**
 * Resolves the bundled ffmpeg / ffprobe binaries. Override with
 * FOOTBALLOS_FFMPEG / FOOTBALLOS_FFPROBE (absolute paths) when the host
 * provides its own build. Binaries are always invoked with execFile and an
 * argument array; no shell string is ever built from user data.
 */
export function ffmpegPath(): string {
  const fromEnv = process.env['FOOTBALLOS_FFMPEG'];
  if (fromEnv) return fromEnv;
  const p = require('ffmpeg-static') as string | null;
  if (!p) throw new Error('ffmpeg-static did not ship a binary for this platform');
  return p;
}

export function ffprobePath(): string {
  const fromEnv = process.env['FOOTBALLOS_FFPROBE'];
  if (fromEnv) return fromEnv;
  const mod = require('ffprobe-static') as { path: string };
  return mod.path;
}

export function assertBinariesAvailable(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = ffmpegPath();
  const ffprobe = ffprobePath();
  for (const bin of [ffmpeg, ffprobe]) {
    try {
      accessSync(bin, constants.X_OK);
    } catch {
      throw new Error(`media binary is not executable: ${bin}`);
    }
  }
  return { ffmpeg, ffprobe };
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with each chunk of stderr (ffmpeg writes logs and -progress there unless redirected). */
  onStderr?: (chunk: string) => void;
  /** Called with each chunk of stdout. */
  onStdout?: (chunk: string) => void;
  maxBufferBytes?: number;
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export class MediaToolError extends Error {
  readonly code: string;
  readonly args: string[];
  readonly stderrTail: string;
  constructor(code: string, message: string, args: string[], stderrTail: string) {
    super(message);
    this.name = 'MediaToolError';
    this.code = code;
    this.args = args;
    this.stderrTail = stderrTail;
  }
}

function tail(s: string, n = 2000): string {
  return s.length > n ? s.slice(s.length - n) : s;
}

/** Runs a binary with an argument array. Rejects with MediaToolError on non-zero exit or abort. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = execFile(
      bin,
      args,
      {
        maxBuffer: opts.maxBufferBytes ?? 256 * 1024 * 1024,
        windowsHide: true,
        signal: opts.signal,
        timeout: opts.timeoutMs,
        encoding: 'utf8',
      },
      (error) => {
        if (error) {
          const aborted = opts.signal?.aborted === true || (error as NodeJS.ErrnoException).name === 'AbortError';
          const code = aborted ? 'aborted' : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'binary_missing' : 'tool_failed';
          reject(new MediaToolError(code, aborted ? `${bin} aborted` : `${bin} failed: ${error.message}`, args, tail(stderr)));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      opts.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      opts.onStderr?.(chunk);
    });
  });
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], opts);
}

export function runFfprobe(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run(ffprobePath(), ['-hide_banner', ...args], opts);
}
