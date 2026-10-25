/**
 * Library interfaces owed by C (`@footballos/media`) and D (`@footballos/ai`) for Milestone C
 * (CONTRACTS §15.5). The API codes against these shapes; `src/libs/index.ts` binds them to local
 * stubs until the packages land, then to the real exports. Shapes mirror the packages' public
 * types so the switch is an import change, not a refactor.
 */
import type {
  Concept, ConceptKind, DepthChart, GamePlanVersion, ModelProvenance, PersonnelPackage, Player, Recommendation, ReviewFlag, Unit,
} from '@footballos/contracts';
import type { ScoutingReport } from '@footballos/ai';
import type { PlanInputHashes } from '../db/schema.js';

// C: document extraction -----------------------------------------------------------------------

export type PageTextSource = 'pdf_text' | 'ocr' | 'none';

export interface ExtractedPage {
  pageNumber: number;
  /** Rendered page PNG on disk; null when the extractor rendered nothing (plain-text input, stub). */
  imagePath: string | null;
  width: number | null;
  height: number | null;
  /** Untrusted data. */
  text: string | null;
  textSource: PageTextSource;
  ocrConfidence: number | null;
}

export interface ExtractDocumentResult {
  pageCount: number;
  pages: ExtractedPage[];
  warnings: string[];
}

export interface ExtractDocumentOptions {
  renderDpi?: number;
  ocr?: 'auto' | 'off';
}

export type ExtractDocument = (path: string, outDir: string, options?: ExtractDocumentOptions) => Promise<ExtractDocumentResult>;

export interface DocumentJobInput {
  assetId: string;
  sourcePath: string;
  outDir: string;
}

export interface DocumentHandlerContext {
  signal: AbortSignal;
  progress(done: number, total: number | null, message: string): void | Promise<void>;
}

export type DocumentHandler<R> = (job: { id: string; input: DocumentJobInput }, ctx: DocumentHandlerContext) => Promise<R>;

export interface DocumentHandlers {
  extract_document: DocumentHandler<ExtractDocumentResult>;
}

export type CreateDocumentHandlers = (options: { dataDir: string; renderDpi?: number; ocr?: 'auto' | 'off' }) => DocumentHandlers;

// D: proposals ---------------------------------------------------------------------------------

export interface ProposalPage {
  pageNumber: number;
  text: string | null;
  textSource: PageTextSource;
  imagePath?: string | null;
  width?: number | null;
  height?: number | null;
  ocrConfidence?: number | null;
}

export type ProposalBasis = 'text' | 'model';

export interface ProposalSource {
  pageNumber: number;
  excerpt: string | null;
}

export interface ProposedConcept {
  name: string;
  kind: ConceptKind;
  description: string;
  sources: ProposalSource[];
  basis: ProposalBasis;
  note: string;
}

export interface ProposedTerm {
  term: string;
  definition: string;
  sources: ProposalSource[];
  basis: ProposalBasis;
  note: string;
}

export interface ProposeResult {
  concepts: ProposedConcept[];
  terms: ProposedTerm[];
  basis: ProposalBasis | 'none';
  note: string;
  provenance?: ModelProvenance[];
}

export type ProposeFromPages = (pages: ProposalPage[], options?: { labeler?: unknown; vocabulary?: unknown }) => Promise<ProposeResult>;

// D: recommendations and review flags ------------------------------------------------------------

export interface RecommendationInputs {
  report: ScoutingReport;
  playbook: { versionId: string | null; concepts: Concept[] };
  personnel: { players: Player[]; packages: PersonnelPackage[]; depthChart: DepthChart | null; week: number | null };
  unit: Unit;
  gameId: string;
  teamId: string;
}

export interface BuildRecommendationsResult {
  items: Recommendation[];
  blockedReasons: string[];
  inputsHash: string;
}

export type BuildRecommendations = (inputs: RecommendationInputs & { now?: () => Date; newId?: () => string }) => BuildRecommendationsResult;
export type RecommendationInputsHash = (inputs: RecommendationInputs) => string;

export interface PlanReviewFlagsInput {
  version: GamePlanVersion & { inputHashes: PlanInputHashes };
  /** Recommendations of the plan's game and unit as reported on read (with computed `stale`). */
  recommendations: Recommendation[];
  currentHashes: PlanInputHashes;
  now?: () => Date;
}

export type PlanReviewFlags = (input: PlanReviewFlagsInput) => ReviewFlag[];

export interface CoachingLibs {
  extractDocument: ExtractDocument;
  createDocumentHandlers: CreateDocumentHandlers;
  proposeFromPages: ProposeFromPages;
  buildRecommendations: BuildRecommendations;
  recommendationInputsHash: RecommendationInputsHash;
  planReviewFlags: PlanReviewFlags;
  /** Part of the extract_document idempotency key: changes when the extractor or proposer changes. */
  version: string;
}
