export * from "./types.js";
export * from "./errors.js";
export * from "./config.js";
export { loadPrompt, LABEL_SEGMENT_PROMPT_ID, LABEL_SEGMENT_PROMPT_VERSION, type PromptTemplate } from "./prompts/index.js";
export * from "./labeler/types.js";
export { LABEL_RESPONSE_JSON_SCHEMA, LABEL_VOCABULARY, labelResponseSchema, type LabelResponse } from "./labeler/schema.js";
export { validateLabelResponse, type ValidationContext } from "./labeler/validate.js";
export { assertLabelInput } from "./labeler/input.js";
export {
  OllamaClient, checkOllama, mapTransportError,
  type FetchLike, type OllamaChatParams, type OllamaChatResult, type OllamaClientOptions, type OllamaShowResult, type OllamaStatus,
} from "./ollama/client.js";
export { OllamaVisionLabeler, buildContextText, type OllamaVisionLabelerOptions } from "./labeler/ollama.js";
export { createVisionLabeler, createPageLabeler, type CreateLabelerOptions } from "./labeler/factory.js";
export { planFrameSampling, type FramePlan, type FramePlanInput, type CoverageGap } from "./frames/plan.js";
export * from "./jobs/infer-labels.js";
export * from "./labels/apply.js";
export * from "./scouting/report.js";
export * from "./stats/resolve.js";
export * from "./stats/findings.js";
export * from "./eval/types.js";
export * from "./eval/jsonl.js";
export * from "./eval/split.js";
export { evaluate } from "./eval/metrics.js";
export * from "./eval/segmentation.js";
export * from "./playbook/types.js";
export { DEFAULT_CONCEPT_VOCABULARY, guessKind, mergeVocabulary } from "./playbook/vocabulary.js";
export { proposeFromText, dedupeConcepts, dedupeTerms } from "./playbook/heuristics.js";
export { PAGE_RESPONSE_JSON_SCHEMA, pageResponseSchema, validatePageResponse, type PageResponse } from "./playbook/schema.js";
export { OllamaPageLabeler, buildPageContextText, PLAYBOOK_PAGE_PROMPT_ID, PLAYBOOK_PAGE_PROMPT_VERSION, type OllamaPageLabelerOptions } from "./playbook/ollama-page-labeler.js";
export { proposeFromPages, loadPageImageFromDisk } from "./playbook/propose.js";
export * from "./recommendations/types.js";
export { CONCEPT_KINDS_BY_RECOMMENDATION, REPORT_UNIT_FOR_PLAN_UNIT, classifyFinding, findingFacets, situationLabel, type Classification, type FindingFacets } from "./recommendations/matching.js";
export { RECOMMENDATION_HASH_VERSION, labelsHash, personnelHash, playbookHash, recommendationInputHashes, recommendationInputsHash } from "./recommendations/hash.js";
export { DEFAULT_MIN_FORMATION_PERCENT, DEFAULT_MIN_SAMPLE, DEFAULT_MIN_TENDENCY_PERCENT, buildRecommendations, evaluatePackages, installedConcepts } from "./recommendations/build.js";
export { planReviewFlags } from "./recommendations/flags.js";
