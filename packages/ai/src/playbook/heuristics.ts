/**
 * Text heuristics for playbook pages (CONTRACTS §15.1): headings and numbered lines become
 * proposed concepts, "Term — definition" / "Term: definition" lines become proposed terms.
 * Every proposal cites the page and the exact line it came from. Nothing is inferred about a
 * diagram; a page without text produces nothing here.
 */
import type { ConceptKind } from "@footballos/contracts";
import { guessKind, sectionKindFromHeading } from "./vocabulary.js";
import type { ConceptVocabulary, ProposalPage, ProposedConcept, ProposedTerm } from "./types.js";

export interface TextProposals {
  concepts: ProposedConcept[];
  terms: ProposedTerm[];
}

const MAX_NAME = 120;
const MAX_DESCRIPTION = 4000;
const MAX_EXCERPT = 300;
const MAX_HEADING_CHARS = 60;
const MAX_HEADING_WORDS = 8;

const NUMBERED = /^\s*\(?(\d{1,3})[.)]\s+(\S.*)$/;
const BULLET = /^\s*[-•*·]\s+(\S.*)$/;
const MARKDOWN_HEADING = /^\s*#{1,6}\s+(\S.*)$/;
/** "Term — definition" (em/en dash) or " - " with spaces both sides, or "Term: definition". */
const DASH_TERM = /^(.{2,60}?)\s+[—–-]\s+(\S.*)$/;
const COLON_TERM = /^([^:]{2,60}?):\s+(\S.*)$/;
const NOISE = [/^page\s+\d+(\s+of\s+\d+)?$/i, /^\d+(\s*\/\s*\d+)?$/, /^[-=_*#•·.\s]+$/, /^confidential/i, /^property of/i, /^table of contents$/i, /^contents$/i];
/** Organisational headings (install days, weeks, scripts, the document title): reset the section, never a concept. */
const ORGANISATIONAL = /^((install|day|week|period|practice|script|session|phase|game plan|opening script|playbook)\b.*|.*\bplaybook\b.*)$/i;
/** "Week 3: at Demo High", "Page 2 — Runs": labels, not terms. */
const LABEL_LEFT = /^(week|day|period|page|game|quarter|section|chapter|install|phase)\s*\d+$/i;
const SECTION_HEADING = /^(the\s+)?(run|runs|rush|rushing|pass|passes|passing|protection|protections|front|fronts|coverage|coverages|pressure|pressures|blitz|blitzes|formation|formations|special teams|kicking|kickoff|punt|term|terms|glossary|definition|definitions|vocabulary|offense|offence|defense|defence|install|installs|overview|notes|personnel|packages|situations|red zone|third down|two minute|goal line)(\s+(game|plays|calls|menu|package|install|section|list|chart|sheet))?:?$/i;

interface Section {
  kind: ConceptKind | null;
  /** True under a "Terms"/"Glossary" heading: "Name — text" lines are terms, never plays. */
  terms: boolean;
}

type Current = { type: "concept"; item: ProposedConcept } | { type: "term"; item: ProposedTerm } | null;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function hasLetters(s: string): boolean {
  return /[a-z]/i.test(s);
}

function isNoise(line: string): boolean {
  return !hasLetters(line) || NOISE.some((re) => re.test(line));
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Short, no sentence punctuation at the end, Title Case or ALL CAPS. */
function looksLikeHeading(line: string): boolean {
  if (line.length > MAX_HEADING_CHARS || wordCount(line) > MAX_HEADING_WORDS) return false;
  if (/[.,;!?]$/.test(line)) return false;
  if (!hasLetters(line)) return false;
  const words = line.replace(/:$/, "").split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return false;
  const allCaps = words.every((w) => w === w.toUpperCase());
  const capitalized = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return allCaps || capitalized / words.length >= 0.5;
}

function splitTerm(line: string): { left: string; right: string } | null {
  const m = DASH_TERM.exec(line) ?? COLON_TERM.exec(line);
  if (!m) return null;
  const left = (m[1] as string).trim();
  const right = (m[2] as string).trim();
  if (!hasLetters(left) || wordCount(left) > MAX_HEADING_WORDS || /[.;!?]$/.test(left)) return null;
  // "3: 45" style times or "Week 3: at Demo" schedule lines are not terms.
  if (/^\d+$/.test(left) || LABEL_LEFT.test(left)) return null;
  return { left, right };
}

function sourceNote(page: ProposalPage, how: string): string {
  const src = page.textSource === "ocr" ? `OCR text${page.ocrConfidence !== null && page.ocrConfidence !== undefined ? ` (confidence ${page.ocrConfidence.toFixed(2)})` : ""}; verify the spelling against the page` : "PDF text layer";
  return `${how} on page ${page.pageNumber} (${src}). Proposed by text rules, not by a model; the diagram, if any, was not read.`;
}

/**
 * Run the heuristics over one page's text. `sectionKind` from a previous page is carried in
 * so a numbered list that continues onto the next page keeps its kind.
 */
export function proposeFromText(page: ProposalPage, vocabulary: Required<ConceptVocabulary>, custom: ConceptVocabulary | undefined, carried: Section | null = null): TextProposals & { section: Section | null } {
  const concepts: ProposedConcept[] = [];
  const terms: ProposedTerm[] = [];
  if (!page.text || page.text.trim() === "") return { concepts, terms, section: carried };

  let section: Section | null = carried;
  let current: Current = null;

  const source = (line: string) => ({ pageNumber: page.pageNumber, excerpt: clip(line, MAX_EXCERPT) });

  const pushConcept = (name: string, description: string, line: string, how: string): void => {
    const n = clip(name, MAX_NAME);
    if (n.length === 0) return;
    const item: ProposedConcept = {
      name: n,
      kind: guessKind(n, { description, vocabulary, sectionKind: section?.kind ?? null, custom }),
      description: clip(description, MAX_DESCRIPTION),
      sources: [source(line)],
      basis: "text",
      note: sourceNote(page, how),
    };
    concepts.push(item);
    current = { type: "concept", item };
  };

  const pushTerm = (term: string, definition: string, line: string, how: string): void => {
    const t = clip(term, MAX_NAME);
    if (t.length === 0 || definition.trim().length === 0) return;
    const item: ProposedTerm = { term: t, definition: clip(definition, MAX_DESCRIPTION), sources: [source(line)], basis: "text", note: sourceNote(page, how) };
    terms.push(item);
    current = { type: "term", item };
  };

  const appendDescription = (text: string): void => {
    if (!current) return;
    const t = clip(text, MAX_EXCERPT);
    if (current.type === "concept") {
      current.item.description = clip(current.item.description ? `${current.item.description} ${t}` : t, MAX_DESCRIPTION);
    } else {
      current.item.definition = clip(`${current.item.definition} ${t}`, MAX_DESCRIPTION);
    }
  };

  for (const raw of page.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      current = null;
      continue;
    }
    if (isNoise(line)) continue;

    const md = MARKDOWN_HEADING.exec(line);
    const headingText = md ? (md[1] as string).trim() : line;

    if (ORGANISATIONAL.test(headingText) && (md || looksLikeHeading(headingText) || splitTerm(headingText) !== null) && !NUMBERED.test(line)) {
      section = { kind: null, terms: false };
      current = null;
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const body = (numbered[2] as string).trim();
      const split = splitTerm(body);
      if (section?.terms) {
        if (split) pushTerm(split.left, split.right, line, `Numbered line ${numbered[1]}`);
        else pushTerm(body, "", line, `Numbered line ${numbered[1]}`); // ignored: no definition
        continue;
      }
      if (split) pushConcept(split.left, split.right, line, `Numbered play ${numbered[1]}`);
      else pushConcept(body, "", line, `Numbered play ${numbered[1]}`);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const body = (bullet[1] as string).trim();
      const split = splitTerm(body);
      if (split) {
        if (section && !section.terms && section.kind) pushConcept(split.left, split.right, line, "Bulleted line");
        else pushTerm(split.left, split.right, line, '"Term — definition" line');
      } else {
        appendDescription(body);
      }
      continue;
    }

    const split = splitTerm(line);
    if (split && !md) {
      if (section && !section.terms && section.kind && looksLikeHeading(split.left)) pushConcept(split.left, split.right, line, '"Name — description" line');
      else pushTerm(split.left, split.right, line, '"Term — definition" line');
      continue;
    }

    if (md || looksLikeHeading(headingText)) {
      const clean = headingText.replace(/:$/, "").trim();
      if (SECTION_HEADING.test(clean)) {
        section = { kind: sectionKindFromHeading(clean, vocabulary), terms: /\b(terms?|glossary|definitions?|vocabulary)\b/i.test(clean) };
        current = null;
        continue;
      }
      pushConcept(clean, "", line, "Heading");
      continue;
    }

    appendDescription(line);
  }

  return { concepts, terms, section };
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Merge duplicates (same name, case/punctuation-insensitive) across pages, keeping every source. */
export function dedupeConcepts(items: ProposedConcept[]): ProposedConcept[] {
  const byName = new Map<string, ProposedConcept>();
  for (const c of items) {
    const key = normalizeName(c.name);
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { ...c, sources: [...c.sources] });
      continue;
    }
    prev.sources.push(...c.sources);
    if (prev.description === "" && c.description !== "") prev.description = c.description;
    if (prev.kind === "other" && c.kind !== "other") prev.kind = c.kind;
    if (prev.basis !== c.basis) prev.note = `${prev.note} Also found on page ${c.sources[0]?.pageNumber} (${c.basis}).`;
  }
  return [...byName.values()];
}

export function dedupeTerms(items: ProposedTerm[]): ProposedTerm[] {
  const byTerm = new Map<string, ProposedTerm>();
  for (const t of items) {
    const key = normalizeName(t.term);
    const prev = byTerm.get(key);
    if (!prev) {
      byTerm.set(key, { ...t, sources: [...t.sources] });
      continue;
    }
    prev.sources.push(...t.sources);
    if (prev.definition === "" && t.definition !== "") prev.definition = t.definition;
  }
  return [...byTerm.values()].filter((t) => t.definition.trim() !== "");
}
