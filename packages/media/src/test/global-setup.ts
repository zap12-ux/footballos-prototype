import { ensureDocumentFixtures } from './document-fixtures.ts';
import { DOCUMENTS_DIR, ensureQuietThenPlay, ensureShaky, ensureSyntheticAsset } from './fixtures.ts';

/** Builds the derived test assets once per vitest run (cached on disk under .data/wt-c3). */
export default async function setup(): Promise<void> {
  const started = Date.now();
  const m = await ensureSyntheticAsset();
  await ensureQuietThenPlay();
  await ensureShaky();
  await ensureDocumentFixtures(DOCUMENTS_DIR);
  process.stdout.write(`[media tests] fixtures ready in ${((Date.now() - started) / 1000).toFixed(1)} s: synthetic asset ${m.totalSec}s, ${m.plays.length} plays; demo documents in ${DOCUMENTS_DIR}\n`);
}
