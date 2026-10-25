/**
 * Public locations for the repository and its documents. No personal contact details.
 * The prototype is published as its own public repository and deployed to GitHub Pages from it.
 */
export const REPO_URL = 'https://github.com/zap12-ux/footballos-prototype';
export const LIVE_URL = 'https://zap12-ux.github.io/footballos-prototype/';
const DOCS_BASE = `${REPO_URL}/blob/main/docs`;
export const DOC_URLS = {
  rationale: `${DOCS_BASE}/MODULE7_DESIGN_RATIONALE.md`,
  protocol: `${DOCS_BASE}/USABILITY_TEST_PROTOCOL.md`,
  aiUse: `${DOCS_BASE}/AI_USE_DISCLOSURE.md`,
  readme: `${REPO_URL}#readme`,
} as const;

export const COURSE_LINE =
  'MPIM 6750 Developing AI Solutions, Georgetown University · Module 7: Hands-On — AI Product UI Prototype';
