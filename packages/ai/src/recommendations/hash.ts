/**
 * Stable hashes over recommendation inputs (CONTRACTS §15.3 `inputsHash`, §15.4 review flags).
 * Canonical JSON with sorted keys and sorted rows, sha256 hex. Any change to a finding's
 * value, an installed concept's version, a player's availability or the week changes the hash.
 */
import { createHash } from "node:crypto";
import type { RecommendationInputHashes, RecommendationInputs } from "./types.js";

export const RECOMMENDATION_HASH_VERSION = "rec-hash-1";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function byFirst<T extends [string, ...unknown[]]>(a: T, b: T): number {
  return a[0].localeCompare(b[0]);
}

export function labelsHash(report: RecommendationInputs["report"]): string {
  return sha256({
    v: RECOMMENDATION_HASH_VERSION,
    teamId: report.teamId,
    opponentId: report.opponentId,
    unit: report.unit,
    reviewBasis: report.reviewBasis,
    reportInputsHash: report.inputsHash ?? null,
    findings: report.findings
      .map((f) => [f.id, f.kind, f.numerator, f.denominator, f.reviewBasis, [...f.gameIds].sort(), f.computeVersion] as [string, ...unknown[]])
      .sort(byFirst),
  });
}

export function playbookHash(playbook: RecommendationInputs["playbook"]): string {
  return sha256({
    v: RECOMMENDATION_HASH_VERSION,
    versionId: playbook.versionId,
    status: playbook.status ?? null,
    concepts: playbook.concepts
      .filter((c) => c.status === "approved" && c.installed && (playbook.versionId === null || c.versionId === playbook.versionId))
      .map((c) => [c.id, c.version, c.kind] as [string, ...unknown[]])
      .sort(byFirst),
  });
}

export function personnelHash(personnel: RecommendationInputs["personnel"]): string {
  return sha256({
    v: RECOMMENDATION_HASH_VERSION,
    week: personnel.week,
    players: personnel.players
      .map((p) => [p.id, p.version, p.status, [...(p.availability ?? [])].map((a) => [a.week, a.status]).sort((a, b) => Number(a[0]) - Number(b[0]))] as [string, ...unknown[]])
      .sort(byFirst),
    packages: personnel.packages.map((p) => [p.id, p.version, p.unit, [...p.playerIds].sort()] as [string, ...unknown[]]).sort(byFirst),
    depthChart: personnel.depthChart ? [personnel.depthChart.id, personnel.depthChart.version] : null,
  });
}

/** All four hashes; `inputsHash` is what each `Recommendation` stores. */
export function recommendationInputHashes(inputs: RecommendationInputs): RecommendationInputHashes {
  const labels = labelsHash(inputs.report);
  const playbook = playbookHash(inputs.playbook);
  const personnel = personnelHash(inputs.personnel);
  const inputsHash = sha256({ v: RECOMMENDATION_HASH_VERSION, unit: inputs.unit, gameId: inputs.gameId, labels, playbook, personnel });
  return { inputsHash, labelsHash: labels, playbookHash: playbook, personnelHash: personnel };
}

/** CONTRACTS §15.5 `recommendationInputsHash(inputs)`. */
export function recommendationInputsHash(inputs: RecommendationInputs): string {
  return recommendationInputHashes(inputs).inputsHash;
}
