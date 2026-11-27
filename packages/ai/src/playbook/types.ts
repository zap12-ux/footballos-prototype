/**
 * Playbook proposals (CONTRACTS §15.1, §15.5). Pages come from C's `extractDocument`
 * (`packages/media`) or from stored `PlaybookPage` rows; proposals go to B's API, which
 * persists them as `Concept` / `Term` rows with `status: 'proposed'`.
 *
 * Everything here is a *proposal*: a coach approves, edits or rejects it. Text found on a
 * page is untrusted data; a diagram is never "understood" from text, and nothing is
 * proposed from an image without a model result.
 */
import type { ConceptKind } from "@footballos/contracts";
import type { ModelProvenance } from "../types.js";

/** Where a page's text came from (CONTRACTS §15.1; mirrors C's `extractDocument` output). */
export type PageTextSource = "pdf_text" | "ocr" | "none";

/**
 * One page as `proposeFromPages` needs it. Either C's extracted page
 * (`{ pageNumber, imagePath, width, height, text, textSource, ocrConfidence }`) or a stored
 * `PlaybookPage` mapped by the API (`ocrText` → `text`, `imageKey` → `imagePath`).
 */
export interface ProposalPage {
  pageNumber: number;
  /** Untrusted text from the PDF text layer or OCR; null when the page has none. */
  text: string | null;
  textSource: PageTextSource;
  /** Rendered page image on local disk (PNG); needed only for the model path. */
  imagePath?: string | null;
  width?: number | null;
  height?: number | null;
  ocrConfidence?: number | null;
}

/** Where a proposal came from. */
export type ProposalBasis = "text" | "model";

export interface ProposalSource {
  pageNumber: number;
  /** The line(s) the proposal was read from; null for model proposals (page number only). */
  excerpt: string | null;
}

export interface ProposedConcept {
  name: string;
  kind: ConceptKind;
  description: string;
  sources: ProposalSource[];
  basis: ProposalBasis;
  /** Plain-language note for the reviewing coach (how it was found, how sure we are). */
  note: string;
}

export interface ProposedTerm {
  term: string;
  definition: string;
  sources: ProposalSource[];
  basis: ProposalBasis;
  note: string;
}

/** Keyword lists per kind; matched case-insensitively against concept names (longest phrase first). */
export type ConceptVocabulary = Partial<Record<ConceptKind, readonly string[]>>;

/** Outcome of one page, so the UI can say exactly what happened to each. */
export interface PageOutcome {
  pageNumber: number;
  textSource: PageTextSource;
  /** `text`: heuristics ran; `model`: the page image was sent to a model; `none`: nothing could be proposed. */
  basis: ProposalBasis | "none";
  concepts: number;
  terms: number;
  /** Model path only: the model looked and declined to propose anything. */
  abstained: boolean;
  note: string;
}

export interface ProposeResult {
  concepts: ProposedConcept[];
  terms: ProposedTerm[];
  /**
   * `model` when at least one proposal came from a model, `text` when all came from text
   * heuristics, `none` when there are no proposals.
   */
  basis: ProposalBasis | "none";
  note: string;
  pages: PageOutcome[];
  /** One record per model call actually made (empty without a labeler). */
  provenance: ModelProvenance[];
}

// Model path --------------------------------------------------------------------------------

export interface PageImage {
  /** Raw base64 (no data: prefix). */
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  width: number | null;
  height: number | null;
}

export interface LabelPageInput {
  pageNumber: number;
  image: PageImage;
  /** Team vocabulary, passed to the model verbatim as data (never as instructions). */
  vocabulary?: ConceptVocabulary;
}

export interface ModelProposedConcept {
  name: string;
  kind: ConceptKind;
  description: string;
  confidence: "low" | "medium" | "high";
}

export interface ModelProposedTerm {
  term: string;
  definition: string;
}

export interface LabelPageOutput {
  /** True when the model could not read a play or term from the page; lists are then empty. */
  abstained: boolean;
  rationale: string;
  concepts: ModelProposedConcept[];
  terms: ModelProposedTerm[];
  provenance: ModelProvenance;
}

/**
 * The document counterpart of `VisionLabeler`: reads one rendered playbook page. Either
 * returns proposals with provenance (possibly an abstention) or throws
 * `ProviderUnavailableError`; never a canned proposal.
 */
export interface PageLabeler {
  readonly provider: ModelProvenance["provider"];
  isAvailable(): boolean;
  labelPage(input: LabelPageInput): Promise<LabelPageOutput>;
}

export interface ProposeOptions {
  /** When present and available, pages with `textSource: 'none'` are sent as images. */
  labeler?: PageLabeler | null;
  /** Extra or overriding keywords per kind; merged over `DEFAULT_CONCEPT_VOCABULARY`. */
  vocabulary?: ConceptVocabulary;
  /** Reads a page image for the model path. Defaults to reading `page.imagePath` from disk. */
  loadImage?: (page: ProposalPage) => Promise<PageImage>;
  /**
   * Why no labeler was passed (for example the Ollama preflight failed): quoted in the note of
   * every image-only page so the coach sees the real cause instead of "no model configured".
   */
  modelUnavailable?: string | null;
}
