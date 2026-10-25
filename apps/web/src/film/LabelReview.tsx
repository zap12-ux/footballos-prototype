import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import type { Api } from '../api/api';
import { ApiError } from '../api/api';
import { describeError, useAction, useResource } from '../api/hooks';
import { LABEL_KEYS, LABEL_KEY_LABELS, EVIDENCE_ONLY_KEYS, type AcceptedStatus, type Label, type MediaAsset, type ModelProvenance, type PlaySegment } from '../api/contracts';
import { EmptyState, SaveStatus, StatusBadge, formatDateTime, formatSeconds, humanize } from '../components/shell/ui';
import { DEFAULT_LABEL_FILTER, applyLabelFilter, planBulkAccept, uncertaintyWord, type LabelFilter } from './review';

interface Props {
  api: Api;
  asset: MediaAsset;
  segments: PlaySegment[];
  labels: Label[];
  provenance: ModelProvenance[];
  queue: ReadonlySet<string>;
  activeSegmentId: string | null;
  canEdit: boolean;
  userName: (userId: string | null) => string;
  timeZone?: string;
  onSeek: (sec: number) => void;
  onChanged: () => void;
}

const STATUSES: AcceptedStatus[] = ['inferred', 'accepted', 'corrected', 'unknown', 'rejected'];

function cellText(label: Label): string {
  if (label.accepted.status === 'inferred') return label.inferred?.abstained ? 'abstained' : (label.inferred?.value ?? '—');
  if (label.accepted.status === 'unknown') return label.inferred ? (label.inferred.abstained ? 'abstained' : 'unknown') : '—';
  if (label.accepted.status === 'rejected') return 'rejected';
  return label.accepted.value ?? '—';
}

const STATUS_GLYPH: Record<AcceptedStatus, string> = { inferred: '?', accepted: '✓', corrected: '✎', unknown: '∅', rejected: '✗' };

/**
 * Label review (§14.5): segments × keys with the inferred value, abstention, uncertainty word,
 * accepted status and author/time; filters; single-label correction with reason; bulk accept
 * of inferred, non-abstained labels with a confirmation that states the counts; revision
 * history; provenance per segment. Nothing here ever fills in a value the model did not give.
 */
export function LabelReview({ api, asset, segments, labels, provenance, queue, activeSegmentId, canEdit, userName, timeZone, onSeek, onChanged }: Props) {
  const id = useId();
  const [filter, setFilter] = useState<LabelFilter>(DEFAULT_LABEL_FILTER);
  const [queueOnly, setQueueOnly] = useState(false);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ accepted: number; skipped: number } | null>(null);

  const effectiveFilter = useMemo<LabelFilter>(() => ({ ...filter, segmentIds: queueOnly ? queue : null }), [filter, queueOnly, queue]);
  const visibleLabels = useMemo(() => applyLabelFilter(labels, effectiveFilter), [labels, effectiveFilter]);
  const visibleSegmentIds = new Set(visibleLabels.map((l) => l.segmentId));
  const ordered = [...segments].sort((a, b) => a.startSec - b.startSec).filter((s) => visibleSegmentIds.has(s.id));
  const keys = (filter.key === 'all' ? LABEL_KEYS : [filter.key]).filter((k) => labels.some((l) => l.key === k));
  const byCell = new Map(labels.map((l) => [`${l.segmentId}:${l.key}`, l]));
  const plan = useMemo(() => planBulkAccept(visibleLabels), [visibleLabels]);
  const selected = labels.find((l) => l.id === selectedLabelId) ?? null;

  const bulk = useAction(async () => {
    const result = await api.labels.bulkAccept(asset.id, { segmentIds: plan.segmentIds, keys: plan.keys });
    setBulkResult(result);
    setConfirming(false);
    onChanged();
    return result;
  });

  return (
    <section className="label-review" aria-labelledby={`${id}-h`}>
      <div className="timeline-head">
        <h3 id={`${id}-h`}>Labels ({labels.length})</h3>
        <p className="small muted">
          Each cell shows the value in use. ? model proposal · ✓ accepted · ✎ corrected · ∅ unknown · ✗ rejected. The model may abstain; an abstention has no value and is never accepted in bulk.
        </p>
      </div>
      <div className="review-filters" role="group" aria-label="Label filters">
        <label>
          Status
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as LabelFilter['status'] })}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Key
          <select value={filter.key} onChange={(e) => setFilter({ ...filter, key: e.target.value as LabelFilter['key'] })}>
            <option value="all">All keys</option>
            {LABEL_KEYS.filter((k) => labels.some((l) => l.key === k)).map((k) => (
              <option key={k} value={k}>
                {LABEL_KEY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={filter.abstainedOnly} onChange={(e) => setFilter({ ...filter, abstainedOnly: e.target.checked })} /> Abstained only
        </label>
        <label className="check">
          <input type="checkbox" checked={queueOnly} onChange={(e) => setQueueOnly(e.target.checked)} /> Review queue only
        </label>
        <span className="small muted" data-testid="label-filter-count">
          {visibleLabels.length} label{visibleLabels.length === 1 ? '' : 's'} across {ordered.length} play{ordered.length === 1 ? '' : 's'}
        </span>
        {canEdit ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={plan.eligible.length === 0 || bulk.status === 'saving'}>
            Accept inferred labels in view ({plan.eligible.length})
          </button>
        ) : null}
        {bulkResult ? (
          <span className="save-status saved" role="status" data-testid="bulk-result">
            Bulk accept: {bulkResult.accepted} accepted, {bulkResult.skipped} skipped
          </span>
        ) : null}
        <SaveStatus status={bulk.status === 'saved' ? 'idle' : bulk.status} error={bulk.error} />
      </div>

      {confirming ? (
        <div className="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby={`${id}-bulk-h`} className="dialog card">
            <h3 id={`${id}-bulk-h`}>Accept {plan.eligible.length} inferred label{plan.eligible.length === 1 ? '' : 's'}?</h3>
            <p data-testid="bulk-plan">
              This accepts <strong>{plan.eligible.length}</strong> model-proposed value{plan.eligible.length === 1 ? '' : 's'} across <strong>{plan.segmentIds.length}</strong> play
              {plan.segmentIds.length === 1 ? '' : 's'} ({plan.keys.map((k) => LABEL_KEY_LABELS[k]).join(', ')}). Skipped in this view: {plan.skippedAbstained} abstention
              {plan.skippedAbstained === 1 ? '' : 's'} (no value to accept) and {plan.skippedReviewed} label{plan.skippedReviewed === 1 ? '' : 's'} already reviewed.
            </p>
            <p className="small muted">Each accepted label records you as the reviewer with the time; corrections stay undisturbed.</p>
            <div className="btn-row">
              <button type="button" className="primary" onClick={() => void bulk.run()} disabled={bulk.status === 'saving'}>
                Accept {plan.eligible.length}
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {ordered.length === 0 ? (
        <EmptyState title="No labels match these filters." />
      ) : (
        <div className="table-scroll review-scroll">
          <table className="review-table">
            <thead>
              <tr>
                <th scope="col">Play</th>
                {keys.map((k) => (
                  <th scope="col" key={k}>
                    {LABEL_KEY_LABELS[k]}
                    {EVIDENCE_ONLY_KEYS.includes(k) ? <span className="small muted block">evidence only</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((s) => (
                <tr key={s.id} className={s.id === activeSegmentId ? 'active' : undefined}>
                  <th scope="row">
                    <button type="button" className="link" onClick={() => onSeek(s.startSec)} title="Play this cut">
                      #{s.index} <span className="mono small">{formatSeconds(s.startSec)}</span>
                    </button>
                  </th>
                  {keys.map((k) => {
                    const label = byCell.get(`${s.id}:${k}`);
                    if (!label) return <td key={k} className="muted">—</td>;
                    const hidden = !visibleLabels.includes(label);
                    return (
                      <td key={k} className={`cell status-${label.accepted.status}${hidden ? ' dimmed' : ''}`}>
                        <button
                          type="button"
                          className={`cell-btn${selectedLabelId === label.id ? ' selected' : ''}`}
                          aria-pressed={selectedLabelId === label.id}
                          onClick={() => setSelectedLabelId(label.id)}
                          aria-label={`${LABEL_KEY_LABELS[k]} for play ${s.index}: ${cellText(label)}, ${humanize(label.accepted.status)}, ${uncertaintyWord(label)}`}
                        >
                          <span className="glyph" aria-hidden="true">
                            {STATUS_GLYPH[label.accepted.status]}
                          </span>{' '}
                          {cellText(label)}
                          <span className="small muted block">{uncertaintyWord(label)}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <LabelPanel
          key={selected.id}
          api={api}
          label={selected}
          segment={segments.find((s) => s.id === selected.segmentId) ?? null}
          provenance={provenance.find((p) => p.id === selected.provenanceId) ?? null}
          canEdit={canEdit}
          userName={userName}
          timeZone={timeZone}
          onSeek={onSeek}
          onClose={() => setSelectedLabelId(null)}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
}

interface PanelProps {
  api: Api;
  label: Label;
  segment: PlaySegment | null;
  provenance: ModelProvenance | null;
  canEdit: boolean;
  userName: (userId: string | null) => string;
  timeZone?: string;
  onSeek: (sec: number) => void;
  onClose: () => void;
  onChanged: () => void;
}

function LabelPanel({ api, label, segment, provenance, canEdit, userName, timeZone, onSeek, onClose, onChanged }: PanelProps) {
  const id = useId();
  const canAccept = !!label.inferred && !label.inferred.abstained;
  const [status, setStatus] = useState<'accepted' | 'corrected' | 'unknown' | 'rejected'>(canAccept ? 'accepted' : 'corrected');
  const [value, setValue] = useState(label.accepted.value ?? label.inferred?.value ?? '');
  const [reason, setReason] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const history = useResource(async () => (historyOpen ? api.labels.revisions(label.id) : []), [api, label.id, label.version, historyOpen]);

  useEffect(() => setConflict(false), [label.version]);

  const save = useAction(async () => {
    try {
      const next = await api.labels.correct(label.id, { accepted: { value: status === 'corrected' ? value.trim() : null, status }, reason: reason.trim() || undefined, expectedVersion: label.version });
      setReason('');
      onChanged();
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      throw error;
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    void save.run();
  }

  return (
    <aside className="label-panel card" aria-labelledby={`${id}-h`}>
      <div className="asset-head">
        <h3 id={`${id}-h`}>
          {LABEL_KEY_LABELS[label.key]} · play {segment?.index ?? '?'}
        </h3>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="kv">
        <dt>Model</dt>
        <dd>
          {label.inferred ? (
            <>
              {label.inferred.abstained ? <strong>Abstained</strong> : <strong>{label.inferred.value}</strong>} · {uncertaintyWord(label)}
              <br />
              <span className="small">{label.inferred.rationale}</span>
              {label.inferred.evidence.length ? (
                <span className="small block">
                  Looked at:{' '}
                  {label.inferred.evidence.map((e, i) => (
                    <button key={i} type="button" className="link" onClick={() => onSeek(e.atSec)}>
                      {formatSeconds(e.atSec)}
                      {e.toSec !== null ? `–${formatSeconds(e.toSec)}` : ''}
                    </button>
                  ))}
                  {label.inferred.evidence.map((e) => e.note).filter(Boolean).join('; ')}
                </span>
              ) : null}
            </>
          ) : (
            <span className="muted">No model output for this label yet.</span>
          )}
        </dd>
        <dt>In use</dt>
        <dd>
          <StatusBadge value={label.accepted.status} /> {label.accepted.value ?? (label.accepted.status === 'unknown' ? 'unknown' : '—')}
          {label.accepted.byUserId ? (
            <span className="small muted block">
              by {userName(label.accepted.byUserId)} · {formatDateTime(label.accepted.at, timeZone)}
            </span>
          ) : (
            <span className="small muted block">not reviewed</span>
          )}
        </dd>
      </dl>

      {canEdit ? (
        <form onSubmit={submit} className="correction-form">
          <fieldset>
            <legend>Correction</legend>
            <div className="radio-row">
              {canAccept ? (
                <label>
                  <input type="radio" name={`${id}-st`} checked={status === 'accepted'} onChange={() => setStatus('accepted')} /> Accept the model's value
                </label>
              ) : null}
              <label>
                <input type="radio" name={`${id}-st`} checked={status === 'corrected'} onChange={() => setStatus('corrected')} /> Correct to
              </label>
              <label>
                <input type="radio" name={`${id}-st`} checked={status === 'unknown'} onChange={() => setStatus('unknown')} /> Cannot be established
              </label>
              <label>
                <input type="radio" name={`${id}-st`} checked={status === 'rejected'} onChange={() => setStatus('rejected')} /> Reject (unusable)
              </label>
            </div>
          </fieldset>
          <label htmlFor={`${id}-value`}>
            Value
            <input id={`${id}-value`} type="text" value={value} onChange={(e) => setValue(e.target.value)} disabled={status !== 'corrected'} required={status === 'corrected'} />
          </label>
          <label htmlFor={`${id}-reason`}>
            Reason (kept in the revision history)
            <input id={`${id}-reason`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did you see?" />
          </label>
          <div className="btn-row">
            <button type="submit" className="primary" disabled={save.status === 'saving'}>
              Save label
            </button>
            <SaveStatus status={save.status} error={save.error} savedText="Label saved" />
          </div>
          {conflict ? (
            <p className="callout warn small" role="alert">
              This label changed elsewhere since you opened it (version {label.version} was expected). Reload to see the current value, then decide again.
            </p>
          ) : null}
        </form>
      ) : (
        <p className="small muted">Viewers can read labels but not change them.</p>
      )}

      <button type="button" className="link" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
        {historyOpen ? 'Hide revision history' : 'Show revision history'}
      </button>
      {historyOpen ? (
        <div className="revision-drawer" data-testid="revision-history">
          {history.status === 'loading' ? (
            <p className="small muted">Loading history…</p>
          ) : history.status === 'error' ? (
            <p className="small field-error">{describeError(history.error)}</p>
          ) : history.data && history.data.length ? (
            <ol className="revision-list small">
              {history.data.map((r) => (
                <li key={r.id}>
                  {formatDateTime(r.at, timeZone)} · {userName(r.byUserId)}: {humanize(r.previousStatus)} {r.previousValue ?? '—'} → {humanize(r.newStatus)} {r.newValue ?? '—'}
                  {r.reason ? <span className="muted"> · “{r.reason}”</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="small muted">No revisions yet: this label is as the model (or the server) created it.</p>
          )}
        </div>
      ) : null}

      <ProvenancePanel provenance={provenance} onSeek={onSeek} timeZone={timeZone} />
    </aside>
  );
}

export function ProvenancePanel({ provenance, onSeek, timeZone }: { provenance: ModelProvenance | null; onSeek: (sec: number) => void; timeZone?: string }) {
  if (!provenance) {
    return (
      <p className="small muted" data-testid="provenance">
        No model provenance: this label has no inferred block.
      </p>
    );
  }
  return (
    <dl className="kv provenance" data-testid="provenance">
      <dt>Model</dt>
      <dd>
        {provenance.provider} · {provenance.model}
        {provenance.modelRevision ? ` (${provenance.modelRevision})` : ''} · analysis {provenance.analysisVersion}
      </dd>
      <dt>Prompt</dt>
      <dd className="mono small">
        {provenance.promptId} · {provenance.promptHash}
      </dd>
      <dt>Frames inspected</dt>
      <dd>
        {provenance.preprocessing.frameCount} frame{provenance.preprocessing.frameCount === 1 ? '' : 's'} at {provenance.preprocessing.samplingFps ?? '?'} fps, {provenance.preprocessing.resolution}, from{' '}
        {formatSeconds(provenance.inspected.fromSec)} to {formatSeconds(provenance.inspected.toSec)}:
        <span className="block frame-times">
          {provenance.inspected.frameTimestampsSec.map((t) => (
            <button key={t} type="button" className="link mono small" onClick={() => onSeek(t)}>
              {t.toFixed(1)}s
            </button>
          ))}
        </span>
      </dd>
      <dt>Cost</dt>
      <dd>
        ${provenance.costUsd.toFixed(4)} · {provenance.inputTokens.toLocaleString()} in / {provenance.outputTokens.toLocaleString()} out tokens · {provenance.latencyMs} ms · {formatDateTime(provenance.completedAt, timeZone)}
      </dd>
    </dl>
  );
}
