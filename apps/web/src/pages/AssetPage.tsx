import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApi, useAction, useResource } from '../api/hooks';
import { ApiError } from '../api/api';
import type { Label, MediaAsset, ModelProvenance, PlaySegment, ProcessingJob } from '../api/contracts';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, StatusBadge, formatBytes, formatDateTime, formatSeconds, humanize } from '../components/shell/ui';
import { JobList } from '../components/film/JobList';
import { LabelReview } from '../film/LabelReview';
import { SegmentTimeline } from '../film/SegmentTimeline';
import { ThumbnailStrip } from '../film/ThumbnailStrip';
import { VideoPlayer, type VideoPlayerHandle } from '../film/VideoPlayer';
import { isJobActive, useJobPolling } from '../film/jobPolling';
import { nextAdjacent, planSeek, standInToOriginal, type SeekPlan } from '../film/review';
import { useGrant } from '../film/useGrant';
import { useWorkspace } from '../workspace/WorkspaceContext';

interface AssetData {
  asset: MediaAsset;
  segments: PlaySegment[];
  labels: Label[];
  provenance: ModelProvenance[];
}

export function FootageQualityNotes({ asset }: { asset: MediaAsset }) {
  const q = asset.quality;
  if (!q) return <p className="small muted">Footage not assessed yet.</p>;
  const tri = (v: boolean | null, yes: string, no: string) => (v === null ? 'not assessed' : v ? yes : no);
  return (
    <div className="quality" data-testid="quality">
      <p className="small">
        Footage check: stable camera {tri(q.stable, 'yes', 'no')}; line of scrimmage {tri(q.lineOfScrimmageVisible, 'visible', 'not visible')}; all 22 players {tri(q.allTwentyTwoVisible, 'visible', 'not always visible')}.
      </p>
      {q.notes.length ? (
        <ul className="small quality-notes">
          {q.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {q.unevaluable.length ? (
        <div className="small">
          <strong>Could not evaluate:</strong>
          <ul className="small quality-notes" data-testid="unevaluable">
            {q.unevaluable.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-asset view: footage quality, jobs, the proxy player with thumbnails, the segment
 * timeline (split / merge / accept / reject with `expectedVersion`) and the label review.
 * `?t=<sec>` opens the player at that time (evidence links from scouting).
 */
export function AssetPage() {
  const { assetId = '' } = useParams();
  const [params] = useSearchParams();
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const team = ws.team;
  const player = useRef<VideoPlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queue, setQueue] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Evidence seeks (HC-05, OC-02, PC-01): the last resolved seek, said at the player, and the
  // play a stand-in clip currently stands for so the playhead reads original-file time.
  const [seekPlan, setSeekPlan] = useState<SeekPlan | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const standIn = useRef<PlaySegment | null>(null);
  const seededQueue = useRef(false);
  const seekedToParam = useRef(false);
  /** Set by the first seek of any kind; until then a stand-in clip follows the selected play. */
  const everSeeked = useRef(false);

  const data = useResource<AssetData>(async () => {
    const asset = await api.media.asset(assetId);
    const [segments, labels, provenance] = await Promise.all([api.media.segments(assetId), api.labels.forAsset(assetId), api.labels.provenance(assetId)]);
    return { asset, segments, labels, provenance };
  }, [api, assetId]);
  const jobs = useJobPolling(api, team?.id ?? null, assetId);
  const staff = useResource(async () => (team ? api.teams.staff(team.id) : null), [api, team?.id]);
  const userName = useCallback(
    (userId: string | null) => {
      if (!userId) return 'nobody';
      if (userId === me.user.id) return 'you';
      return staff.data?.members.find((m) => m.userId === userId)?.user.displayName ?? 'a coach';
    },
    [staff.data, me.user.id],
  );

  const asset = data.data?.asset ?? null;
  const playable = !!asset && (asset.status === 'ready' || asset.status === 'processing' || asset.status === 'validated');
  const grant = useGrant(api, assetId, playable);
  // What the stream can show: the grant says so for a stand-in; a real proxy's length comes from the element.
  const proxy = grant.grant?.proxy ?? (mediaDuration !== null ? { standIn: false, durationSec: mediaDuration } : null);
  const segments = data.data?.segments ?? [];
  const canEdit = me.memberships.some((m) => m.teamId === team?.id && m.role !== 'viewer');

  // Owner decision (B3 question): proposed cuts start out in the review queue.
  useEffect(() => {
    if (!data.data || seededQueue.current) return;
    seededQueue.current = true;
    const proposed = data.data.segments.filter((s) => s.reviewStatus === 'proposed').sort((a, b) => a.startSec - b.startSec);
    setQueue(new Set(proposed.map((s) => s.id)));
    const t = Number(params.get('t'));
    // An evidence link opens on the play that contains `t`, or the nearest one.
    const atT =
      params.has('t') && Number.isFinite(t)
        ? [...data.data.segments].sort((a, b) => Math.abs(a.startSec - t) - Math.abs(b.startSec - t)).find((s) => (t >= s.startSec && t <= s.endSec) || Math.abs(s.startSec - t) <= 130)
        : undefined;
    setActiveId(atT?.id ?? proposed[0]?.id ?? data.data.segments[0]?.id ?? null);
  }, [data.data, params]);

  // Keep the queue to segments that still exist and are still proposed.
  useEffect(() => {
    if (!data.data) return;
    const live = new Set(data.data.segments.filter((s) => s.reviewStatus === 'proposed').map((s) => s.id));
    setQueue((q) => {
      const next = new Set([...q].filter((id) => live.has(id)));
      return next.size === q.size ? q : next;
    });
  }, [data.data]);

  const seekTo = useCallback(
    (sec: number, play = true): SeekPlan => {
      const plan = planSeek(sec, segments, proxy);
      everSeeked.current = true;
      if (plan.kind === 'stand_in') standIn.current = plan.segment;
      else if (plan.kind === 'direct') standIn.current = null;
      if (plan.mediaSec !== null) {
        player.current?.seekTo(plan.mediaSec, play);
        setCurrentTime(sec);
      }
      setSeekPlan(plan);
      return plan;
    },
    [segments, proxy],
  );

  // `?t=` seeks once the grant and the plays exist; an unplayable moment is said, not skipped.
  useEffect(() => {
    if (seekedToParam.current || !grant.grant || !data.data || !params.has('t')) return;
    const t = Number(params.get('t'));
    if (Number.isFinite(t)) {
      seekedToParam.current = true;
      seekTo(t);
    }
  }, [grant.grant, data.data, params, seekTo]);

  // Without `?t=`, a stand-in clip is anchored to the selected play so the playhead and the
  // caption name the moment it stands for instead of 0:00 of an unrelated clip.
  useEffect(() => {
    if (everSeeked.current || !grant.grant?.proxy?.standIn || !data.data || !activeId) return;
    const active = data.data.segments.find((s) => s.id === activeId);
    if (active) seekTo(active.startSec, false);
  }, [grant.grant, data.data, activeId, seekTo]);

  const onMediaTime = useCallback((mediaSec: number) => {
    const anchor = standIn.current;
    setCurrentTime(anchor ? standInToOriginal(mediaSec, anchor) : mediaSec);
  }, []);

  // When a job chain finishes, the asset, its segments and labels may have changed.
  const wasActive = useRef(false);
  useEffect(() => {
    const active = jobs.jobs.some(isJobActive);
    if (wasActive.current && !active) data.reload();
    wasActive.current = active;
  }, [jobs.jobs, data]);

  const active = segments.find((s) => s.id === activeId) ?? null;

  // Selecting a play on a stand-in clip anchors the clip to it (no autoplay), so the playhead
  // and caption always name the play the footage stands for.
  const activate = useCallback(
    (segmentId: string) => {
      setActiveId(segmentId);
      const segment = segments.find((s) => s.id === segmentId);
      if (segment && proxy?.standIn) seekTo(segment.startSec, false);
    },
    [segments, proxy, seekTo],
  );

  function onVersionConflict(error: unknown, what: string) {
    if (error instanceof ApiError && error.status === 409) {
      setConflict(`${what} changed elsewhere (version mismatch). Reload the timeline to see the current cuts, then try again.`);
      return true;
    }
    return false;
  }

  function advanceQueue(from: PlaySegment | null) {
    const ordered = segments.filter((s) => queue.has(s.id) && s.id !== from?.id).sort((a, b) => a.startSec - b.startSec);
    const after = from ? ordered.find((s) => s.startSec > from.startSec) : undefined;
    const next = after ?? ordered[0] ?? null;
    if (next) {
      setActiveId(next.id);
      seekTo(next.startSec);
    }
  }

  const review = useAction(async (segment: PlaySegment, reviewStatus: 'accepted' | 'rejected') => {
    setConflict(null);
    try {
      await api.media.updateSegment(segment.id, { reviewStatus, expectedVersion: segment.version });
    } catch (error) {
      if (!onVersionConflict(error, `Play ${segment.index}`)) throw error;
      return;
    }
    setNotice(`Play ${segment.index} ${reviewStatus}.`);
    data.reload();
    advanceQueue(segment);
  });

  const split = useAction(async (segment: PlaySegment) => {
    setConflict(null);
    // The page's playhead state follows the player's `timeupdate` events and every seek.
    const at = currentTime;
    if (!(at > segment.startSec + 0.5 && at < segment.endSec - 0.5)) {
      throw new Error(`Move the playhead inside play ${segment.index} (${formatSeconds(segment.startSec)}–${formatSeconds(segment.endSec)}) first; it is at ${formatSeconds(at)}.`);
    }
    try {
      const result = await api.media.splitSegment(segment.id, { atSec: Math.round(at * 10) / 10, expectedVersion: segment.version });
      setNotice(`Play ${segment.index} split at ${formatSeconds(at)} into two cuts.`);
      setActiveId(result.segments[0]?.id ?? null);
      data.reload();
      return result;
    } catch (error) {
      if (!onVersionConflict(error, `Play ${segment.index}`)) throw error;
      return undefined;
    }
  });

  const merge = useAction(async (segment: PlaySegment) => {
    setConflict(null);
    const next = nextAdjacent(segments, segment);
    if (!next) throw new Error(`Play ${segment.index} is the last cut; there is nothing after it to merge with.`);
    try {
      const result = await api.media.mergeSegments({ segmentIds: [segment.id, next.id], expectedVersion: { [segment.id]: segment.version, [next.id]: next.version } });
      setNotice(`Plays ${segment.index} and ${next.index} merged into one cut (${formatSeconds(result.segment.startSec)}–${formatSeconds(result.segment.endSec)}).`);
      setActiveId(result.segment.id);
      data.reload();
      return result;
    } catch (error) {
      if (!onVersionConflict(error, `Play ${segment.index} or ${next.index}`)) throw error;
      return undefined;
    }
  });

  const infer = useAction(async () => {
    if (!asset) throw new Error('Asset not loaded.');
    const created = await api.labels.infer(asset.id);
    jobs.reload();
    return created;
  });

  const inferJobs = jobs.jobs.filter((j) => j.kind === 'infer_labels').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestInfer: ProcessingJob | undefined = inferJobs[0];
  const busy = review.status === 'saving' || split.status === 'saving' || merge.status === 'saving';
  const actionError = [review, split, merge].find((a) => a.status === 'error')?.error;

  const assetLabel = useMemo(() => (asset ? `${asset.originalFilename} (${asset.context.analyzedTeam === 'us' ? 'our film' : 'opponent film'})` : 'film'), [asset]);

  return (
    <>
      <PageHeader
        title="Our Team Film"
        lede={
          <>
            <Link to={ws.href('/app/film')}>← All film for {ws.gameLabel(ws.game)}</Link>
          </>
        }
      />
      <DataState state={data} label="this film">
        {({ asset: a, labels, provenance }) => (
          <>
            <section className="card asset" aria-labelledby="asset-heading">
              <div className="asset-head">
                <div>
                  <h2 id="asset-heading" className="mono">
                    {a.originalFilename}
                  </h2>
                  <p className="small muted">
                    {a.context.analyzedTeam === 'us' ? 'Our film' : 'Opponent film'} · {humanize(a.context.analyzedUnit)} · {humanize(a.context.perspective)} · {formatBytes(a.byteSize)}
                    {a.durationSec !== null ? ` · ${formatSeconds(a.durationSec)}` : ''}
                    {a.width && a.height ? ` · ${a.width}×${a.height}` : ''}
                    {a.fps ? ` · ${a.fps} fps` : ''} · uploaded {formatDateTime(a.createdAt, team?.timezone)}
                    {a.context.teamCues ? ` · cues: “${a.context.teamCues}”` : ''}
                  </p>
                </div>
                <StatusBadge value={a.status} />
              </div>
              {a.status === 'rejected' ? (
                <p className="callout warn" role="alert">
                  <strong>Rejected.</strong> {a.rejectionReason ?? 'No reason recorded.'}
                </p>
              ) : null}
              <FootageQualityNotes asset={a} />
              <JobList jobs={jobs.jobs} polling={jobs.polling} error={jobs.error} onReload={jobs.reload} api={api} />
            </section>

            {playable ? (
              <div className="asset-layout">
                <div className="asset-main">
                  <VideoPlayer ref={player} grant={grant.grant} grantStatus={grant.status} grantError={grant.error} onRefreshGrant={grant.refresh} onTimeUpdate={onMediaTime} onDuration={setMediaDuration} notice={seekPlan} label={assetLabel} />
                  {grant.grant && a.durationSec ? <ThumbnailStrip grant={grant.grant} durationSec={a.durationSec} currentTime={currentTime} onSeek={seekTo} /> : null}
                  <p className="small muted" data-testid="playhead">
                    Playhead at <span className="mono">{formatSeconds(currentTime)}</span>
                    {active ? ` · play ${active.index} selected (${formatSeconds(active.startSec)}–${formatSeconds(active.endSec)})` : ''}
                  </p>
                </div>
                <div className="asset-side">
                  {conflict ? (
                    <div className="callout warn" role="alert" data-testid="conflict">
                      <p>{conflict}</p>
                      <button type="button" onClick={() => { setConflict(null); data.reload(); }}>
                        Reload timeline
                      </button>
                    </div>
                  ) : null}
                  {notice ? (
                    <p className="small save-status saved" role="status" data-testid="action-notice">
                      {notice}
                    </p>
                  ) : null}
                  {actionError ? <SaveStatus status="error" error={actionError} /> : null}
                  {segments.length === 0 ? (
                    <EmptyState title="No plays proposed yet.">
                      <p className="small">Play boundaries appear when the segment job finishes.</p>
                    </EmptyState>
                  ) : (
                    <SegmentTimeline
                      segments={segments}
                      durationSec={a.durationSec}
                      activeId={activeId}
                      queue={queue}
                      currentTime={currentTime}
                      busy={busy || !canEdit}
                      onActivate={activate}
                      onSeek={(s) => {
                        seekTo(s.startSec);
                      }}
                      onAccept={(s) => void review.run(s, 'accepted')}
                      onReject={(s) => void review.run(s, 'rejected')}
                      onSplit={(s) => void split.run(s)}
                      onMerge={(s) => void merge.run(s)}
                      onNextInQueue={() => advanceQueue(active)}
                    />
                  )}
                </div>
              </div>
            ) : null}

            {a.status === 'ready' ? (
              <section className="card" aria-labelledby="infer-heading">
                <h2 id="infer-heading">Model labels</h2>
                <div className="btn-row">
                  {canEdit ? (
                    <button type="button" className="primary" onClick={() => void infer.run()} disabled={infer.status === 'saving' || (latestInfer ? isJobActive(latestInfer) : false)}>
                      Run inference
                    </button>
                  ) : null}
                  <SaveStatus status={infer.status} error={infer.error} savedText="Inference queued" />
                  {latestInfer ? (
                    <span className="small">
                      Latest: <StatusBadge value={latestInfer.status} /> {latestInfer.progress.message}
                    </span>
                  ) : (
                    <span className="small muted">No inference has been run on this film.</span>
                  )}
                </div>
                {latestInfer?.status === 'failed' && latestInfer.error?.code === 'provider_unavailable' ? (
                  <p className="callout warn" role="alert" data-testid="provider-state">
                    <strong>No model provider is configured.</strong> {latestInfer.error.message} No label was invented; every value below is either the model's earlier output or a coach's entry, and the table stays editable by hand.
                  </p>
                ) : latestInfer?.status === 'failed' ? (
                  <p className="callout warn" role="alert">
                    <strong>Inference failed.</strong> {latestInfer.error?.message ?? 'No detail recorded.'}
                  </p>
                ) : null}
                <LabelReview
                  api={api}
                  asset={a}
                  segments={segments}
                  labels={labels}
                  provenance={provenance}
                  queue={queue}
                  activeSegmentId={activeId}
                  canEdit={canEdit}
                  userName={userName}
                  timeZone={team?.timezone}
                  onSeek={seekTo}
                  onChanged={data.reload}
                />
              </section>
            ) : null}
          </>
        )}
      </DataState>
    </>
  );
}
