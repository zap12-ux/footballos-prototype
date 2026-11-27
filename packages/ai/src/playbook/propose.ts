/**
 * `proposeFromPages(pages, { labeler?, vocabulary? })` (CONTRACTS §15.5): text heuristics on
 * every page that has text; the page image through a `PageLabeler` only for pages with
 * `textSource: 'none'` and only when a labeler is present and available. A page that has
 * neither produces nothing and says so. Proposals from a model carry `basis: 'model'` and the
 * page number only; proposals from text cite the exact line.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { isProviderUnavailable } from "../errors.js";
import type { ModelProvenance } from "../types.js";
import { dedupeConcepts, dedupeTerms, proposeFromText } from "./heuristics.js";
import type { ConceptVocabulary, PageImage, PageOutcome, ProposalPage, ProposeOptions, ProposeResult, ProposedConcept, ProposedTerm } from "./types.js";
import { mergeVocabulary } from "./vocabulary.js";

const MEDIA_TYPES: Record<string, PageImage["mediaType"]> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** Default image loader: the rendered page PNG at `page.imagePath`. */
export async function loadPageImageFromDisk(page: ProposalPage): Promise<PageImage> {
  if (!page.imagePath) throw new Error(`page ${page.pageNumber} has no imagePath`);
  const mediaType = MEDIA_TYPES[extname(page.imagePath).toLowerCase()];
  if (!mediaType) throw new Error(`page ${page.pageNumber}: unsupported image type ${extname(page.imagePath)}`);
  const bytes = await readFile(page.imagePath);
  return { base64: bytes.toString("base64"), mediaType, width: page.width ?? null, height: page.height ?? null };
}

function assertPages(pages: unknown): asserts pages is ProposalPage[] {
  if (!Array.isArray(pages)) throw new TypeError("pages must be an array");
  const seen = new Set<number>();
  for (const p of pages as ProposalPage[]) {
    if (!p || !Number.isInteger(p.pageNumber) || p.pageNumber < 1) throw new TypeError("every page needs a positive integer pageNumber");
    if (seen.has(p.pageNumber)) throw new TypeError(`duplicate pageNumber ${p.pageNumber}`);
    seen.add(p.pageNumber);
    if (p.textSource !== "pdf_text" && p.textSource !== "ocr" && p.textSource !== "none") throw new TypeError(`page ${p.pageNumber}: textSource must be pdf_text|ocr|none`);
    if (p.text !== null && typeof p.text !== "string") throw new TypeError(`page ${p.pageNumber}: text must be a string or null`);
  }
}

export async function proposeFromPages(pages: ProposalPage[], options: ProposeOptions = {}): Promise<ProposeResult> {
  assertPages(pages);
  const custom: ConceptVocabulary | undefined = options.vocabulary;
  const vocabulary = mergeVocabulary(custom);
  const labeler = options.labeler ?? null;
  const loadImage = options.loadImage ?? loadPageImageFromDisk;

  const concepts: ProposedConcept[] = [];
  const terms: ProposedTerm[] = [];
  const provenance: ModelProvenance[] = [];
  const outcomes: PageOutcome[] = [];
  let section: ReturnType<typeof proposeFromText>["section"] = null;
  let modelStopped: string | null = null;

  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const hasText = page.text !== null && page.text.trim() !== "";

    if (hasText) {
      const r = proposeFromText(page, vocabulary, custom, section);
      section = r.section;
      concepts.push(...r.concepts);
      terms.push(...r.terms);
      outcomes.push({
        pageNumber: page.pageNumber,
        textSource: page.textSource,
        basis: "text",
        concepts: r.concepts.length,
        terms: r.terms.length,
        abstained: false,
        note: r.concepts.length + r.terms.length === 0 ? `Page ${page.pageNumber}: text found but no heading, numbered play or "Term — definition" line matched.` : `Page ${page.pageNumber}: ${r.concepts.length} concept(s) and ${r.terms.length} term(s) from ${page.textSource === "ocr" ? "OCR text" : "the text layer"}.`,
      });
      continue;
    }

    if (page.textSource !== "none") {
      outcomes.push({ pageNumber: page.pageNumber, textSource: page.textSource, basis: "none", concepts: 0, terms: 0, abstained: false, note: `Page ${page.pageNumber}: the text layer is empty; nothing proposed. The diagram, if any, was not read.` });
      continue;
    }

    // No text at all: only a model may read the image, and only when one is available.
    if (!labeler) {
      const why = options.modelUnavailable ? `the model is unavailable (${options.modelUnavailable})` : "no model configured";
      outcomes.push({ pageNumber: page.pageNumber, textSource: "none", basis: "none", concepts: 0, terms: 0, abstained: false, note: `Page ${page.pageNumber}: no text layer and ${why}; nothing proposed. Add concepts by hand or start Ollama with a vision model.` });
      continue;
    }
    if (!labeler.isAvailable()) {
      outcomes.push({ pageNumber: page.pageNumber, textSource: "none", basis: "none", concepts: 0, terms: 0, abstained: false, note: `Page ${page.pageNumber}: no text layer and the model server is unavailable; nothing proposed.` });
      continue;
    }
    if (modelStopped) {
      outcomes.push({ pageNumber: page.pageNumber, textSource: "none", basis: "none", concepts: 0, terms: 0, abstained: false, note: `Page ${page.pageNumber}: not sent to the model (${modelStopped}).` });
      continue;
    }

    let image: PageImage;
    try {
      image = await loadImage(page);
    } catch (err) {
      outcomes.push({ pageNumber: page.pageNumber, textSource: "none", basis: "none", concepts: 0, terms: 0, abstained: false, note: `Page ${page.pageNumber}: page image could not be read (${err instanceof Error ? err.message : String(err)}); nothing proposed.` });
      continue;
    }

    try {
      const out = await labeler.labelPage({ pageNumber: page.pageNumber, image, vocabulary: custom });
      provenance.push(out.provenance);
      const note = (what: string) => `${what} by ${out.provenance.provider} model ${out.provenance.model} from the page ${page.pageNumber} image (no text layer). Verify against the page before approving.`;
      for (const c of out.concepts) {
        concepts.push({ name: c.name, kind: c.kind, description: c.description, sources: [{ pageNumber: page.pageNumber, excerpt: null }], basis: "model", note: `${note("Read")} Legibility: ${c.confidence}.` });
      }
      for (const t of out.terms) {
        terms.push({ term: t.term, definition: t.definition, sources: [{ pageNumber: page.pageNumber, excerpt: null }], basis: "model", note: note("Read") });
      }
      outcomes.push({
        pageNumber: page.pageNumber,
        textSource: "none",
        basis: "model",
        concepts: out.concepts.length,
        terms: out.terms.length,
        abstained: out.abstained,
        note: out.abstained ? `Page ${page.pageNumber}: the model looked and proposed nothing (${out.rationale}).` : `Page ${page.pageNumber}: ${out.concepts.length} concept(s) and ${out.terms.length} term(s) read by the model; ${out.rationale}`,
      });
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      // Job-wide conditions stop further calls; page-local ones only skip this page.
      if (err.reason === "unreachable" || err.reason === "model_missing" || err.reason === "model_not_vision") modelStopped = `${err.reason}: ${err.message}`;
      outcomes.push({ pageNumber: page.pageNumber, textSource: "none", basis: "none", concepts: 0, terms: 0, abstained: false, note: `Page ${page.pageNumber}: model unavailable (${err.reason}); nothing proposed.` });
    }
  }

  const finalConcepts = dedupeConcepts(concepts);
  const finalTerms = dedupeTerms(terms);
  const anyModel = finalConcepts.some((c) => c.basis === "model") || finalTerms.some((t) => t.basis === "model");
  const basis: ProposeResult["basis"] = finalConcepts.length + finalTerms.length === 0 ? "none" : anyModel ? "model" : "text";

  const textPages = outcomes.filter((o) => o.basis === "text").length;
  const modelPages = outcomes.filter((o) => o.basis === "model").length;
  const nonePages = outcomes.filter((o) => o.basis === "none").length;
  const note =
    `${finalConcepts.length} concept(s) and ${finalTerms.length} term(s) proposed from ${pages.length} page(s): ` +
    `${textPages} by text rules, ${modelPages} read by a model, ${nonePages} with nothing to propose. ` +
    `Every item is a proposal for coach review; diagrams were not interpreted.`;

  return { concepts: finalConcepts, terms: finalTerms, basis, note, pages: outcomes, provenance };
}
