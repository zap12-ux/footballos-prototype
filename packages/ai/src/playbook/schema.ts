import { ConceptKindSchema } from "@footballos/contracts";
import { z } from "zod";
import { ProviderUnavailableError } from "../errors.js";
import type { Provider } from "../types.js";
import type { LabelPageOutput } from "./types.js";

/**
 * Model output for one playbook page (sent to the API as `output_config.format`, mirrored in
 * zod for local validation). Keyword subset as in `labeler/schema.ts`.
 */
export const pageResponseSchema = z.object({
  abstained: z.boolean(),
  rationale: z.string(),
  concepts: z.array(
    z.object({
      name: z.string(),
      kind: ConceptKindSchema,
      description: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
  terms: z.array(z.object({ term: z.string(), definition: z.string() })),
});
export type PageResponse = z.infer<typeof pageResponseSchema>;

export const PAGE_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    abstained: { type: "boolean", description: "true when no play name or term is legibly written on the page; both lists must then be empty." },
    rationale: { type: "string", description: "One or two sentences on what the page shows and how legible the writing was." },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The play or concept name exactly as written." },
          kind: { type: "string", enum: [...ConceptKindSchema.options] },
          description: { type: "string", description: "Only the coaching text written next to the name; empty when none." },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["name", "kind", "description", "confidence"],
        additionalProperties: false,
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "definition"],
        additionalProperties: false,
      },
    },
  },
  required: ["abstained", "rationale", "concepts", "terms"],
  additionalProperties: false,
};

function invalid(provider: Provider, message: string): ProviderUnavailableError {
  return new ProviderUnavailableError({ provider, reason: "invalid_model_output", retryable: true, message });
}

/**
 * Validate raw model JSON for one page: schema match, an abstention carries no proposals,
 * names and terms are non-empty and within the contracts' length limits. Whitespace is
 * normalized; nothing else is rewritten.
 */
export function validatePageResponse(raw: unknown, provider: Provider): Omit<LabelPageOutput, "provenance"> {
  const parsed = pageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw invalid(provider, `response did not match the playbook-page schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const d = parsed.data;
  if (d.abstained && (d.concepts.length > 0 || d.terms.length > 0)) {
    throw invalid(provider, "model abstained on the page but still returned proposals");
  }
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const concepts = d.concepts.map((c) => ({ name: norm(c.name), kind: c.kind, description: norm(c.description).slice(0, 4000), confidence: c.confidence }));
  const terms = d.terms.map((t) => ({ term: norm(t.term), definition: norm(t.definition).slice(0, 4000) }));
  for (const c of concepts) {
    if (c.name.length === 0 || c.name.length > 120) throw invalid(provider, `model returned a concept name of length ${c.name.length}`);
  }
  for (const t of terms) {
    if (t.term.length === 0 || t.term.length > 120) throw invalid(provider, `model returned a term of length ${t.term.length}`);
    if (t.definition.length === 0) throw invalid(provider, `model returned term "${t.term}" without a definition`);
  }
  if (!d.abstained && concepts.length === 0 && terms.length === 0) {
    throw invalid(provider, "model returned no proposals without marking the page as abstained");
  }
  return { abstained: d.abstained, rationale: norm(d.rationale), concepts, terms };
}
