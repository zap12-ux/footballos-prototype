#!/usr/bin/env node
// Evaluation harness CLI. Requires `npm run build -w packages/ai` first (imports from dist).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distEntry = new URL("../dist/eval/cli.js", import.meta.url);
if (!existsSync(fileURLToPath(distEntry))) {
  console.error("packages/ai is not built. Run: npm run build -w packages/ai");
  process.exit(2);
}
const { main } = await import(distEntry.href);
process.exit(main(process.argv.slice(2)));
