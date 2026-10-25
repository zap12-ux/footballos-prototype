/**
 * Local stand-ins for `@footballos/ai` `proposeFromPages`, `buildRecommendations`,
 * `recommendationInputsHash` and `planReviewFlags` (CONTRACTS §15.5) until D's implementation
 * lands. Deterministic, text-only, no model call. Everything produced here is a *proposal* for a
 * coach; nothing is approved automatically.
 */
import { createHash } from 'node:crypto';
import type { Concept, ConceptKind, Recommendation, ReviewFlag, ScoutingFinding, Unit } from '@footballos/contracts';
import type {
  BuildRecommendations, PlanReviewFlags, ProposalPage, ProposeFromPages, ProposedConcept, ProposedTerm, RecommendationInputs, RecommendationInputsHash,
} from './types.js';

export const STUB_PROPOSER_VERSION = 'stub-propose-1';
export const STUB_RECOMMENDER_VERSION = 'stub-recommend-1';

// Proposals ------------------------------------------------------------------------------------

const KIND_KEYWORDS: [ConceptKind, string[]][] = [
  ['protection', ['protection', 'slide', 'half slide', 'bob', 'scat', 'turn back']],
  ['pressure', ['blitz', 'pressure', 'fire zone', 'dog', 'nickel fire', 'sim']],
  ['coverage', ['cover', 'quarters', 'palms', 'man free', 'robber', 'tampa', 'match']],
  ['front', ['front', 'over', 'under', 'bear', 'okie', 'tite', 'mint', 'odd', 'even', 'stack']],
  ['special_teams', ['punt', 'kickoff', 'kick off', 'field goal', 'pat', 'onside', 'return', 'hands team']],
  ['formation', ['trips', 'ace', 'gun', 'pistol', 'empty', 'bunch', 'doubles', 'i-form', 'wing', 'spread', 'formation']],
  ['pass', ['pass', 'boot', 'screen', 'vert', 'verts', 'flood', 'smash', 'mesh', 'curl', 'slant', 'post', 'wheel', 'rpo', 'play action', 'drive', 'levels']],
  ['run', ['zone', 'power', 'counter', 'duo', 'dive', 'draw', 'sweep', 'toss', 'trap', 'iso', 'lead', 'option', 'read', 'buck', 'stretch', 'wham']],
];

export function guessKindStub(name: string): ConceptKind {
  const s = name.toLowerCase();
  for (const [kind, words] of KIND_KEYWORDS) if (words.some((w) => s.includes(w))) return kind;
  return 'other';
}

const TERM_RE = /^\s*([A-Za-z][A-Za-z0-9 '\-/]{0,60}?)\s*(?:—|–|\s-\s|:)\s+(.{3,})$/;
const NUMBERED_RE = /^\s*(\d{1,3})[.):]\s+(.{2,100})$/;
const HEADING_RE = /^[A-Z][A-Za-z0-9 '\-/&]{1,60}$/;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Text heuristics: headings and numbered play names → concepts; "Term — definition" lines → terms. */
export const proposeFromPagesStub: ProposeFromPages = async (pages: ProposalPage[]) => {
  const concepts: ProposedConcept[] = [];
  const terms: ProposedTerm[] = [];
  const seenConcepts = new Set<string>();
  const seenTerms = new Set<string>();
  let pagesWithText = 0;
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    if (!page.text || page.text.trim() === '') continue;
    pagesWithText++;
    const lines = page.text.split('\n').map(clean).filter(Boolean);
    for (const line of lines) {
      const term = TERM_RE.exec(line);
      if (term && !/^\d/.test(line)) {
        const name = clean(term[1]!);
        const key = name.toLowerCase();
        if (name.split(' ').length <= 6 && !seenTerms.has(key)) {
          seenTerms.add(key);
          terms.push({ term: name, definition: clean(term[2]!), sources: [{ pageNumber: page.pageNumber, excerpt: line.slice(0, 300) }], basis: 'text', note: `"Term — definition" line on page ${page.pageNumber} (text heuristics; review before approving).` });
        }
        continue;
      }
      const numbered = NUMBERED_RE.exec(line);
      const candidate = numbered ? clean(numbered[2]!) : HEADING_RE.test(line) && line.split(' ').length <= 6 ? line : null;
      if (!candidate) continue;
      if (/^(terms?|glossary|notes?|page \d+|install \d+|week \d+|table of contents|contents)$/i.test(candidate)) continue;
      const key = candidate.toLowerCase();
      if (seenConcepts.has(key)) continue;
      seenConcepts.add(key);
      concepts.push({
        name: candidate, kind: guessKindStub(candidate), description: '',
        sources: [{ pageNumber: page.pageNumber, excerpt: line.slice(0, 300) }], basis: 'text',
        note: `${numbered ? 'Numbered line' : 'Heading'} on page ${page.pageNumber}; kind guessed from the name (text heuristics, API stub). A diagram on the page was not read.`,
      });
    }
  }
  const total = concepts.length + terms.length;
  const noText = pages.length - pagesWithText;
  const note = total === 0
    ? pagesWithText === 0
      ? 'No page has a text layer and no model is configured: nothing was proposed. Add concepts by hand or install the document extractor with OCR.'
      : 'Text was found but no heading, numbered play or "Term — definition" line matched; nothing was proposed.'
    : `${concepts.length} concept(s) and ${terms.length} term(s) proposed from text on ${pagesWithText} page(s)${noText ? `; ${noText} page(s) without text produced nothing` : ''}. Diagrams were not read.`;
  return { concepts, terms, basis: total === 0 ? 'none' : 'text', note, provenance: [] };
};

// Recommendations ------------------------------------------------------------------------------

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export function playbookHashStub(playbook: RecommendationInputs['playbook']): string {
  return sha256({ versionId: playbook.versionId, concepts: [...playbook.concepts].sort(byId).map((c) => [c.id, c.version, c.installed, c.status]) });
}

export function personnelHashStub(personnel: RecommendationInputs['personnel']): string {
  return sha256({
    week: personnel.week,
    players: [...personnel.players].sort(byId).map((p) => [p.id, p.version]),
    packages: [...personnel.packages].sort(byId).map((p) => [p.id, p.version]),
    depthChart: personnel.depthChart ? [personnel.depthChart.id, personnel.depthChart.version] : null,
  });
}

export const recommendationInputsHashStub: RecommendationInputsHash = (inputs) =>
  sha256({ v: STUB_RECOMMENDER_VERSION, unit: inputs.unit, gameId: inputs.gameId, report: inputs.report.inputsHash, playbook: playbookHashStub(inputs.playbook), personnel: personnelHashStub(inputs.personnel) });

/** Which installed concept kinds a plan of this unit should pull against an opponent tendency. */
const KINDS_FOR_UNIT: Record<Unit, ConceptKind[]> = {
  offense: ['run', 'pass', 'protection', 'formation'],
  defense: ['front', 'coverage', 'pressure'],
  special_teams: ['special_teams'],
};

const MIN_SAMPLE = 4;

export function unavailablePackageIds(personnel: RecommendationInputs['personnel']): Set<string> {
  const out = new Set<string>();
  const outPlayers = new Set(
    personnel.players
      .filter((p) => p.status === 'inactive' || p.status === 'unavailable' || (personnel.week !== null && p.availability.some((a) => a.week === personnel.week && a.status === 'out')))
      .map((p) => p.id),
  );
  for (const pkg of personnel.packages) if (pkg.playerIds.some((id) => outPlayers.has(id))) out.add(pkg.id);
  return out;
}

export const buildRecommendationsStub: BuildRecommendations = (inputs) => {
  const now = inputs.now ?? (() => new Date());
  const newId = inputs.newId ?? (() => crypto.randomUUID());
  const inputsHash = recommendationInputsHashStub(inputs);
  const blockedReasons: string[] = [];
  if (!inputs.playbook.versionId) blockedReasons.push('no approved playbook version for this unit');
  const installed = inputs.playbook.concepts.filter((c) => c.status === 'approved' && c.installed);
  const usableKinds = KINDS_FOR_UNIT[inputs.unit];
  const grounding: Concept[] = installed.filter((c) => usableKinds.includes(c.kind));
  if (inputs.playbook.versionId && grounding.length === 0) blockedReasons.push(`no installed concepts of kind ${usableKinds.join('/')} in the approved playbook`);
  if (inputs.personnel.players.length === 0) blockedReasons.push('no personnel on the roster for this season');
  const unavailable = unavailablePackageIds(inputs.personnel);
  const availablePackages = inputs.personnel.packages.filter((p) => p.unit === inputs.unit && !unavailable.has(p.id));
  if (inputs.personnel.packages.some((p) => p.unit === inputs.unit) && availablePackages.length === 0) blockedReasons.push('every package of this unit has a player listed out for the game week');
  const eligible = inputs.report.findings.filter((f) => f.denominator >= MIN_SAMPLE && f.kind !== 'uncertain');
  if (inputs.report.findings.length > 0 && eligible.length === 0) blockedReasons.push(`sample too small: every finding has fewer than ${MIN_SAMPLE} plays`);
  if (inputs.report.findings.length === 0) blockedReasons.push('no scouting findings for this opponent (reviewed-only basis)');
  if (blockedReasons.length > 0) return { items: [], blockedReasons, inputsHash };

  const items: Recommendation[] = [];
  const createdAt = now().toISOString();
  const singleGame = inputs.report.games.filter((g) => g.assetIds.length > 0).length <= 1;
  for (const f of eligible) {
    const contrary = findContrary(f, eligible);
    const limitations = [
      `Based on ${f.denominator} reviewed play(s) (${f.reviewBasis.replace('_', ' ')}).`,
      ...(singleGame ? ['Only one game of opponent film; tendencies may not hold.'] : []),
      ...(f.excludedSegmentIds.length ? [`${f.excludedSegmentIds.length} play(s) were excluded for missing situation data.`] : []),
    ];
    items.push({
      id: newId(),
      teamId: inputs.teamId,
      gameId: inputs.gameId,
      unit: inputs.unit,
      statement: statementFor(inputs.unit, f, grounding),
      supportingFindings: [f.id],
      supportingEvidence: f.supportingEvidence.slice(0, 10),
      counts: [{ n: f.numerator, of: f.denominator, context: f.statement }],
      limitations,
      contraryEvidence: contrary.flatMap((c) => c.supportingEvidence.slice(0, 3)),
      playbookConceptIds: grounding.slice(0, 5).map((c) => c.id),
      personnelPackageIds: availablePackages.slice(0, 3).map((p) => p.id),
      status: 'proposed',
      staleReason: null,
      decidedBy: null,
      decidedAt: null,
      inputsHash,
      createdAt,
      version: 1,
      editedStatement: null,
      decisionNote: null,
      storedStatus: 'proposed',
      planItemId: null,
    });
  }
  return { items, blockedReasons: [], inputsHash };
};

function findContrary(f: ScoutingFinding, all: ScoutingFinding[]): ScoutingFinding[] {
  // Same kind, same included plays, but a statement that points the other way is a crude proxy for conflict.
  return all.filter((g) => g.id !== f.id && g.kind === f.kind && g.statement !== f.statement && g.percent !== null && f.percent !== null && Math.abs(g.percent - f.percent) >= 40);
}

function statementFor(unit: Unit, f: ScoutingFinding, grounding: Concept[]): string {
  const names = grounding.slice(0, 3).map((c) => c.name).join(', ');
  const pct = f.percent === null ? '' : ` (${f.percent.toFixed(0)}%, ${f.numerator}/${f.denominator})`;
  const lead = `Opponent: ${f.statement}${pct}.`;
  if (unit === 'defense') return `${lead} Prepare ${names || 'installed fronts, fits and coverages'} for this look.`;
  if (unit === 'offense') return `${lead} Attack it with ${names || 'installed concepts'}.`;
  return `${lead} Review ${names || 'installed special-teams concepts'} against it.`;
}

// Review flags ---------------------------------------------------------------------------------

export const planReviewFlagsStub: PlanReviewFlags = ({ version, recommendations, currentHashes }) => {
  const flags: ReviewFlag[] = [];
  const since = version.approvedAt ?? version.createdAt;
  const stored = version.inputHashes;
  if (stored.playbook !== currentHashes.playbook) flags.push({ kind: 'playbook_changed', message: 'The approved playbook (installed concepts) changed after this version was written.', versionId: version.id, itemId: null, since });
  if (stored.personnel !== currentHashes.personnel) flags.push({ kind: 'personnel_changed', message: 'Roster, availability, packages or the depth chart changed after this version was written.', versionId: version.id, itemId: null, since });
  if (stored.labels !== currentHashes.labels) flags.push({ kind: 'labels_changed', message: 'Opponent film labels changed after this version was written; scouting counts may differ.', versionId: version.id, itemId: null, since });
  const recById = new Map(recommendations.map((r) => [r.id, r]));
  for (const section of version.sections) {
    for (const item of section.items) {
      if (!item.sourceRecommendationId) continue;
      const rec = recById.get(item.sourceRecommendationId);
      if (rec && rec.status === 'stale') {
        flags.push({ kind: 'stale_recommendation', message: `"${item.text.slice(0, 80)}" came from a recommendation whose inputs changed (${rec.staleReason ?? 'inputs changed'}).`, versionId: version.id, itemId: item.id, since: rec.createdAt });
      }
    }
  }
  return flags;
};


