/**
 * Binding of the §15.5 library interfaces. Today every function is the local stub; when the lead
 * confirms that `@footballos/media` exports `extractDocument` / `createDocumentHandlers` and
 * `@footballos/ai` exports `proposeFromPages` / `buildRecommendations` /
 * `recommendationInputsHash` / `planReviewFlags`, replace the right-hand sides with those imports
 * (and bump `version`, which is part of the extract_document idempotency key).
 */
import type { CoachingLibs } from './types.js';
import { createDocumentHandlersStub, extractDocumentStub, STUB_EXTRACTOR_VERSION } from './stub-document.js';
import { buildRecommendationsStub, planReviewFlagsStub, proposeFromPagesStub, recommendationInputsHashStub, STUB_PROPOSER_VERSION, STUB_RECOMMENDER_VERSION } from './stub-ai.js';

export const coachingLibs: CoachingLibs = {
  extractDocument: extractDocumentStub,
  createDocumentHandlers: createDocumentHandlersStub,
  proposeFromPages: proposeFromPagesStub,
  buildRecommendations: buildRecommendationsStub,
  recommendationInputsHash: recommendationInputsHashStub,
  planReviewFlags: planReviewFlagsStub,
  version: `${STUB_EXTRACTOR_VERSION}:${STUB_PROPOSER_VERSION}:${STUB_RECOMMENDER_VERSION}`,
};

export * from './types.js';
export { playbookHashStub as playbookInputsHash, personnelHashStub as personnelInputsHash, unavailablePackageIds } from './stub-ai.js';
