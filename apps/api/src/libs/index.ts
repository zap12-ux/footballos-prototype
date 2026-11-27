/**
 * Binding of the §15.5 library interfaces hosted by the API (CONTRACTS §15.5). Both packages
 * landed on integration on 2026-10-25 (C2-lib, C3-lib); this module is the single place the API
 * imports them from, so a future swap or stub is one file.
 */
export {
  createDocumentHandlers, asDocumentJobHandler, DocumentError, PAGES_DIRNAME, PAGES_FILENAME,
  type DocumentJobInput as MediaDocumentJobInput, type ExtractDocumentJobResult, type ExtractedPage, type TextSource,
} from '@footballos/media';
export {
  proposeFromPages, checkOllama, createPageLabeler, createVisionLabeler, buildRecommendations, recommendationInputHashes, recommendationInputsHash, planReviewFlags,
  RECOMMENDATION_HASH_VERSION, PLAYBOOK_PAGE_PROMPT_VERSION, REPORT_UNIT_FOR_PLAN_UNIT, evaluatePackages,
  type ProposalPage, type ProposeResult, type ProposedConcept, type ProposedTerm, type PageLabeler,
  type RecommendationInputs, type RecommendationInputHashes, type BuildRecommendationsResult, type PlanReviewFlagsInput, type OllamaStatus,
} from '@footballos/ai';

/** Part of the extract_document idempotency key: changes when the extractor or the proposer changes. */
export const DOCUMENT_PIPELINE_VERSION = 'doc-pipeline-1';
