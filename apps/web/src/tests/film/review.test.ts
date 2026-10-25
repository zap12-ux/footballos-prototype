import { describe, expect, it } from 'vitest';
import type { Label, PlaySegment } from '../../api/contracts';
import { applyLabelFilter, DEFAULT_LABEL_FILTER, isBulkAcceptable, nextAdjacent, planBulkAccept, thumbIndexFor, thumbUrl, uncertaintyWord } from '../../film/review';
import { isJobActive } from '../../film/jobPolling';
import * as demo from '../../api/mock/data';

function label(over: Partial<Label> & { id: string }): Label {
  return {
    teamId: 't', segmentId: 'seg-1', key: 'play_type', inferred: { value: 'run', abstained: false, rationale: '', evidence: [], uncertainty: 'low' },
    accepted: { value: 'run', status: 'inferred', byUserId: null, at: null }, provenanceId: null, version: 1, createdAt: '', updatedAt: '', ...over,
  };
}

describe('§14.5 bulk-accept rule', () => {
  const inferred = label({ id: 'a' });
  const abstained = label({ id: 'b', inferred: { value: null, abstained: true, rationale: '', evidence: [], uncertainty: null }, accepted: { value: null, status: 'inferred', byUserId: null, at: null } });
  const accepted = label({ id: 'c', accepted: { value: 'run', status: 'accepted', byUserId: 'u', at: 'now' } });
  const corrected = label({ id: 'd', segmentId: 'seg-2', key: 'formation_family', accepted: { value: 'ace', status: 'corrected', byUserId: 'u', at: 'now' } });
  const noModel = label({ id: 'e', segmentId: 'seg-3', inferred: null, accepted: { value: null, status: 'unknown', byUserId: null, at: null } });

  it('accepts only inferred, non-abstained labels', () => {
    expect([inferred, abstained, accepted, corrected, noModel].map(isBulkAcceptable)).toEqual([true, false, false, false, false]);
  });

  it('plans the counts shown in the confirmation', () => {
    const plan = planBulkAccept([inferred, abstained, accepted, corrected, noModel]);
    expect(plan.eligible.map((l) => l.id)).toEqual(['a']);
    expect(plan.skippedAbstained).toBe(1);
    expect(plan.skippedReviewed).toBe(3);
    expect(plan.segmentIds).toEqual(['seg-1']);
    expect(plan.keys).toEqual(['play_type']);
  });

  it('matches the demo data: 50 acceptable labels, every abstention skipped', () => {
    const plan = planBulkAccept(demo.labels);
    expect(plan.eligible.length).toBe(50);
    expect(plan.eligible.every((l) => l.inferred && !l.inferred.abstained && l.accepted.status === 'inferred')).toBe(true);
    expect(demo.labels.filter((l) => l.inferred?.abstained).every((l) => !isBulkAcceptable(l))).toBe(true);
  });
});

describe('label filters', () => {
  it('filters by status, key, abstention and segment set', () => {
    const labels = demo.labels;
    expect(applyLabelFilter(labels, { ...DEFAULT_LABEL_FILTER, status: 'corrected' }).every((l) => l.accepted.status === 'corrected')).toBe(true);
    expect(applyLabelFilter(labels, { ...DEFAULT_LABEL_FILTER, key: 'hash' }).every((l) => l.key === 'hash')).toBe(true);
    const abst = applyLabelFilter(labels, { ...DEFAULT_LABEL_FILTER, abstainedOnly: true });
    expect(abst.length).toBeGreaterThan(0);
    expect(abst.every((l) => l.inferred?.abstained)).toBe(true);
    expect(applyLabelFilter(labels, { ...DEFAULT_LABEL_FILTER, segmentIds: new Set(['seg-westmoor-1-1']) })).toHaveLength(demo.DEMO_LABEL_KEYS.length);
  });

  it('describes uncertainty in words only', () => {
    expect(uncertaintyWord(label({ id: 'x' }))).toBe('confident');
    expect(uncertaintyWord(label({ id: 'x', inferred: { value: 'a', abstained: false, rationale: '', evidence: [], uncertainty: 'high' } }))).toBe('very unsure');
    expect(uncertaintyWord(label({ id: 'x', inferred: { value: null, abstained: true, rationale: '', evidence: [], uncertainty: null } }))).toBe('abstained');
    expect(uncertaintyWord(label({ id: 'x', inferred: null }))).toBe('no model output');
  });
});

describe('segments and thumbnails', () => {
  const seg = (id: string, startSec: number): PlaySegment => ({ id, teamId: 't', assetId: 'a', gameId: 'g', index: 0, startSec, endSec: startSec + 5, origin: 'proposed', reviewStatus: 'proposed', supersededBy: [], version: 1, createdAt: '', updatedAt: '' });
  it('finds the next play in time order regardless of array order', () => {
    const s = [seg('c', 30), seg('a', 10), seg('b', 20)];
    expect(nextAdjacent(s, s[1])?.id).toBe('b');
    expect(nextAdjacent(s, s[0])).toBeNull();
  });
  it('maps a time to its thumbnail tile and fills the template', () => {
    expect(thumbIndexFor(0, 10)).toBe(0);
    expect(thumbIndexFor(312.4, 10)).toBe(31);
    expect(thumbUrl('/media/a/thumb/{n}?token=x', 31)).toBe('/media/a/thumb/31?token=x');
    expect(thumbUrl('data:image/svg+xml,%3Csvg%3E%7Bn%7D', 4)).toBe('data:image/svg+xml,%3Csvg%3E4');
  });
  it('treats queued, running and retry_wait jobs as active', () => {
    expect(demo.jobs.filter(isJobActive).map((j) => j.status).sort()).toEqual(['queued', 'retry_wait', 'running']);
  });
});
