#!/usr/bin/env node
// Evaluation harness CLI. Requires `npm run build -w packages/ai` (imports dist/).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/eval/cli.js", import.meta.url);
if (!existsSync(fileURLToPath(dist))) {
  console.error("dist/ not found: run `npm run build -w packages/ai` first");
  process.exit(2);
}
const { runEvalCli } = await import(dist.href);
process.exit(runEvalCli(process.argv.slice(2)));
