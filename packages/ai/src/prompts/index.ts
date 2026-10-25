import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface PromptTemplate {
  /** Stable id recorded in ModelProvenance.promptId (with the version suffix). */
  id: string;
  version: number;
  text: string;
  /** sha256 of the exact prompt text, recorded in ModelProvenance.promptHash. */
  hash: string;
}

const cache = new Map<string, PromptTemplate>();

/**
 * Load a versioned prompt from `src/prompts/<id>.v<version>.md` (copied to `dist/prompts`
 * by the build). The hash is computed over the file bytes so any edit changes provenance.
 */
export function loadPrompt(id: string, version: number): PromptTemplate {
  const key = `${id}.v${version}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const path = fileURLToPath(new URL(`./${key}.md`, import.meta.url));
  const text = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const tpl: PromptTemplate = { id, version, text, hash };
  cache.set(key, tpl);
  return tpl;
}

export const LABEL_SEGMENT_PROMPT_ID = "label-segment";
export const LABEL_SEGMENT_PROMPT_VERSION = 1;
