/**
 * `buildRecommendations` (CONTRACTS §15.3, §15.5): deterministic, grounded, never approved.
 * Every item cites findings, evidence, counts and limitations; it references only installed
 * concepts of the approved playbook whose kind the matching table allows, and only personnel
 * packages that are available for the game week. When nothing grounds, `items` is empty and
 * `blockedReasons` says why. Rules are documented in `docs/ai/RECOMMENDATIONS.md`.
 */
import { randomUUID } from "node:crypto";
import { UnitSchema, type Concept, type ConceptKind } from "@footballos/contracts";
import type { EvidenceRef, Recommendation, ScoutingFinding, Unit } from "../types.js";
import { recommendationInputsHash } from "./hash.js";
import { CONCEPT_KINDS_BY_RECOMMENDATION, REPORT_UNIT_FOR_PLAN_UNIT, classifyFinding, findingFacets, situationLabel, type Classification } from "./matching.js";
import type { BuildRecommendationsInput, BuildRecommendationsResult, PackageAvailability, RecommendationPersonnel, RecommendationType, SkippedFinding } from "./types.js";

export const DEFAULT_MIN_SAMPLE = 4;
export const DEFAULT_MIN_TENDENCY_PERCENT = 60;
export const DEFAULT_MIN_FORMATION_PERCENT = 25;
const MAX_EVIDENCE = 10;

/** Installed, approved concepts of the approved version — the only ones that may ground an item. */
export function installedConcepts(playbook: BuildRecommendationsInput["playbook"]): Concept[] {
  if (playbook.versionId === null) return [];
  return playbook.concepts.filter((c) => c.status === "approved" && c.installed && c.versionId === playbook.versionId);
}

/**
 * Package availability for the plan unit and game week (CONTRACTS §15.2): a package is
 * unavailable when any of its players is `out` for the week, has `status` `unavailable` or
 * `inactive`, or is not on the roster given. `limited` players leave the package available
 * with a caution. Without a week, availability entries cannot be applied and only roster
 * status is checked.
 */
export function evaluatePackages(personnel: RecommendationPersonnel, unit: Unit): PackageAvailability[] {
  const players = new Map(personnel.players.map((p) => [p.id, p]));
  const out: PackageAvailability[] = [];
  for (const pkg of personnel.packages) {
    if (pkg.unit !== unit) continue;
    const reasons: string[] = [];
    const cautions: string[] = [];
    for (const pid of pkg.playerIds) {
      const p = players.get(pid);
      const who = p ? `${p.jersey ? `#${p.jersey} ` : ""}${p.lastName}` : `player ${pid}`;
      if (!p) {
        reasons.push(`${who} is not on the roster given`);
        continue;
      }
      if (p.status === "inactive" || p.status === "unavailable") {
        reasons.push(`${who} is ${p.status}`);
        continue;
      }
      if (personnel.week !== null) {
        const a = (p.availability ?? []).find((x) => x.week === personnel.week);
        if (a?.status === "out") reasons.push(`${who} is out for week ${personnel.week}`);
        else if (a?.status === "limited") cautions.push(`${who} is limited for week ${personnel.week}`);
      }
    }
    out.push({ packageId: pkg.id, name: pkg.name, available: reasons.length === 0, reason: reasons.length > 0 ? reasons.join("; ") : cautions.length > 0 ? cautions.join("; ") : null });
  }
  return out.sort((a, b) => a.packageId.localeCompare(b.packageId));
}

function pct(f: ScoutingFinding): string {
  return f.percent === null ? "n/a" : `${f.percent}%`;
}

function situationPhrase(c: Classification): string {
  return `with ${situationLabel(c.facets.situationKey ?? "")} "${c.facets.situationValue}"`;
}

function statementFor(type: RecommendationType, f: ScoutingFinding, c: Classification, opponentUnit: Unit): string {
  const n = f.numerator;
  const N = f.denominator;
  const form = c.facets.formation;
  switch (type) {
    case "defend_formation":
      return `Expect "${form}" from the opponent offense: it was their formation on ${n} of ${N} plays with a known formation (${pct(f)}). Have a front and a coverage call ready against it.`;
    case "defend_run_tendency":
      return `When the opponent lines up in "${form}", expect run: ${n} of ${N} plays from that look were runs (${pct(f)}). Set the fronts and run fits for this look.`;
    case "defend_pass_tendency":
      return `When the opponent lines up in "${form}", expect pass: ${n} of ${N} plays from that look were passes (${pct(f)}). Plan coverage and pressure for this look.`;
    case "defend_situation_run":
      return `${cap(situationPhrase(c))}, the opponent ran on ${n} of ${N} plays (${pct(f)}). Call run-stopping fronts and pressures in that situation.`;
    case "defend_situation_pass":
      return `${cap(situationPhrase(c))}, the opponent threw on ${n} of ${N} plays (${pct(f)}). Call coverage and pressure in that situation.`;
    case "defend_general":
      return `${f.statement} Prepare fronts, coverages and pressures for it.`;
    case "attack_defensive_look":
      return `Expect the opponent defense in "${form}": it was their look on ${n} of ${N} plays with a known front (${pct(f)}). Pick the runs, passes and protections you want against it.`;
    case "attack_general":
      return `${f.statement} Pick the runs, passes and protections you want against it.`;
    case "special_teams_look":
      return `Expect "${form ?? f.statement}" from the opponent ${opponentUnit.replace("_", " ")}: ${n} of ${N} plays (${pct(f)}). Have the matching special-teams call ready.`;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function countContext(type: RecommendationType, f: ScoutingFinding, c: Classification): string {
  const games = `${f.gameIds.length} game${f.gameIds.length === 1 ? "" : "s"}`;
  switch (type) {
    case "defend_formation":
    case "attack_defensive_look":
    case "special_teams_look":
      return `plays in "${c.facets.formation}" of all plays with a known formation, across ${games}`;
    case "defend_run_tendency":
    case "defend_pass_tendency":
      return `${c.facets.playType} plays of all plays from "${c.facets.formation}" with a known play type, across ${games}`;
    case "defend_situation_run":
    case "defend_situation_pass":
      return `${c.facets.playType} plays of all plays ${situationPhrase(c)} with a known play type, across ${games}`;
    default:
      return `${f.kind.replace(/_/g, " ")} across ${games}`;
  }
}

/** Findings in the same group that point the other way (same look or situation, another play type). */
function contraryFindings(f: ScoutingFinding, c: Classification, all: ScoutingFinding[]): ScoutingFinding[] {
  if (!c.facets.playType) return [];
  return all.filter((g) => {
    if (g.id === f.id || g.kind !== f.kind || g.reviewBasis !== f.reviewBasis) return false;
    const gf = findingFacets(g);
    if (!gf || gf.playType === c.facets.playType) return false;
    if (f.kind === "play_type_by_formation") return gf.formation === c.facets.formation;
    if (f.kind === "tendency_by_situation") return gf.situationKey === c.facets.situationKey && gf.situationValue === c.facets.situationValue;
    return false;
  });
}

function capEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  return refs.slice(0, MAX_EVIDENCE).map((e) => ({ ...e }));
}

function kindsList(kinds: readonly ConceptKind[]): string {
  return kinds.join("/");
}

export function buildRecommendations(input: BuildRecommendationsInput): BuildRecommendationsResult {
  const { report, playbook, personnel, unit, gameId } = input;
  if (!UnitSchema.safeParse(unit).success) throw new TypeError(`unit must be one of ${UnitSchema.options.join("|")}`);
  if (typeof gameId !== "string" || gameId === "") throw new TypeError("gameId is required");
  if (!report || !Array.isArray(report.findings)) throw new TypeError("report.findings is required");
  if (!playbook || !Array.isArray(playbook.concepts)) throw new TypeError("playbook.concepts is required");
  if (!personnel || !Array.isArray(personnel.players) || !Array.isArray(personnel.packages)) throw new TypeError("personnel.players and personnel.packages are required");

  const minSample = input.minSample ?? DEFAULT_MIN_SAMPLE;
  const minTendency = input.minTendencyPercent ?? DEFAULT_MIN_TENDENCY_PERCENT;
  const minFormation = input.minFormationPercent ?? DEFAULT_MIN_FORMATION_PERCENT;
  const now = (input.now ?? (() => new Date()))().toISOString();
  const newId = input.newId ?? randomUUID;
  const inputsHash = recommendationInputsHash({ report, playbook, personnel, unit, gameId });

  const blocked = new Set<string>();
  const skipped: SkippedFinding[] = [];
  const packages = evaluatePackages(personnel, unit);
  const empty = (): BuildRecommendationsResult => ({ items: [], blockedReasons: [...blocked], inputsHash, skipped, packages, types: [] });

  // Preconditions (§15.3): without these, nothing can be grounded.
  if (report.reviewBasis !== "reviewed_only") blocked.add(`the scouting report is on the "${report.reviewBasis}" basis; recommendations use coach-reviewed labels only`);
  const expectedReportUnit = REPORT_UNIT_FOR_PLAN_UNIT[unit];
  if (report.unit !== expectedReportUnit) blocked.add(`a ${unit} plan needs the report on the opponent ${expectedReportUnit}; this report is about the opponent ${report.unit}`);
  if (playbook.versionId === null || (playbook.status !== undefined && playbook.status !== null && playbook.status !== "approved")) blocked.add("no approved playbook");
  const concepts = installedConcepts(playbook);
  if (playbook.versionId !== null && concepts.length === 0 && !blocked.has("no approved playbook")) blocked.add("no installed concepts in the approved playbook");
  if (personnel.players.length === 0 && personnel.packages.length === 0) blocked.add("no personnel");
  if (report.findings.length === 0) blocked.add("no scouting findings for this opponent and unit");
  if (blocked.size > 0) return empty();

  const findings = report.findings.filter((f) => f.reviewBasis === "reviewed_only" && f.unit === report.unit);
  const availablePackageIds = packages.filter((p) => p.available).map((p) => p.packageId);
  const limitedCautions = packages.filter((p) => p.available && p.reason).map((p) => `Package "${p.name}": ${p.reason}.`);
  if (availablePackageIds.length === 0) {
    blocked.add(packages.length === 0 ? `no ${unit} personnel packages are defined` : `no available ${unit} packages${personnel.week !== null ? ` for week ${personnel.week}` : ""}`);
  }

  const tooSmall: string[] = [];
  const missingKinds = new Map<string, number>();
  const items: Recommendation[] = [];
  const types: RecommendationType[] = [];

  const ordered = [...findings].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || b.denominator - a.denominator || a.id.localeCompare(b.id));
  for (const f of ordered) {
    if (f.denominator < minSample) {
      tooSmall.push(f.id);
      skipped.push({ findingId: f.id, reason: `sample too small: ${f.denominator} play(s), minimum ${minSample}` });
      continue;
    }
    const cls = classifyFinding(f, unit);
    if (!cls.ok) {
      skipped.push({ findingId: f.id, reason: cls.reason });
      continue;
    }
    const c = cls.value;
    const threshold = f.kind === "formation_frequency" ? minFormation : f.kind === "play_type_by_formation" || f.kind === "tendency_by_situation" ? minTendency : 0;
    if (f.percent !== null && f.percent < threshold) {
      skipped.push({ findingId: f.id, reason: `no tendency: ${f.numerator} of ${f.denominator} (${f.percent}%) is below ${threshold}%` });
      continue;
    }
    const kinds = CONCEPT_KINDS_BY_RECOMMENDATION[c.type];
    const matched = concepts.filter((k) => kinds.includes(k.kind)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    if (matched.length === 0) {
      const key = kindsList(kinds);
      missingKinds.set(key, (missingKinds.get(key) ?? 0) + 1);
      skipped.push({ findingId: f.id, reason: `no installed concepts of kind ${key}` });
      continue;
    }

    const contrary = contraryFindings(f, c, findings);
    const limitations: string[] = [];
    limitations.push(`Based on ${f.denominator} plays${f.denominator < 2 * minSample ? " (small sample)" : ""} across ${f.gameIds.length} game${f.gameIds.length === 1 ? "" : "s"}.`);
    if (f.gameIds.length === 1) limitations.push("All evidence comes from a single game; check whether it holds on other film before building around it.");
    limitations.push(`Coach-reviewed labels only; ${f.excludedSegmentIds.length} segment(s) were excluded (unreviewed, rejected, unknown or another unit).`);
    if (f.kind === "tendency_by_situation") limitations.push(`Only ${situationLabel(c.facets.situationKey ?? "")} is known for this split; distance, field position, score and clock were not combined.`);
    else limitations.push("Down, distance and field position are not broken out; this is an overall tendency.");
    for (const g of contrary) {
      const gf = findingFacets(g);
      limitations.push(`${g.numerator} of ${g.denominator} plays in the same group went the other way (${gf?.playType ?? "other"}).`);
    }
    if (availablePackageIds.length === 0) limitations.push(packages.length === 0 ? `No ${unit} personnel packages are defined; choose personnel by hand.` : `No ${unit} package is available${personnel.week !== null ? ` for week ${personnel.week}` : ""}; choose personnel by hand.`);
    limitations.push(...limitedCautions);
    if (personnel.week === null) limitations.push("The game week was not given, so weekly availability could not be applied; only roster status was checked.");

    items.push({
      id: newId(),
      teamId: report.teamId,
      gameId,
      unit,
      statement: statementFor(c.type, f, c, report.unit),
      supportingFindings: [f.id],
      supportingEvidence: capEvidence(f.supportingEvidence),
      counts: [{ n: f.numerator, of: f.denominator, context: countContext(c.type, f, c) }],
      limitations,
      contraryEvidence: capEvidence(contrary.flatMap((g) => g.supportingEvidence)),
      playbookConceptIds: matched.map((k) => k.id),
      personnelPackageIds: [...availablePackageIds],
      status: "proposed",
      staleReason: null,
      decidedBy: null,
      decidedAt: null,
      inputsHash,
      createdAt: now,
      version: 1,
    });
    types.push(c.type);
  }

  if (tooSmall.length > 0) blocked.add(`sample too small for ${tooSmall.length} finding(s) (fewer than ${minSample} plays)`);
  for (const [kinds, count] of [...missingKinds.entries()].sort()) blocked.add(`no installed concepts of kind ${kinds} (${count} finding(s) could not be grounded)`);

  return { items, blockedReasons: [...blocked], inputsHash, skipped, packages, types };
}
