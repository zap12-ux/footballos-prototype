import { Fragment, useId, useState, type FormEvent } from 'react';
import { useApi, useAction } from '../api/hooks';
import { seasonRecord, type GameKind, type GameLocation, type GameStatus, type ScheduleImport, type ScheduledGame } from '../api/contracts';
import { EmptyState, PageHeader, SaveStatus, StatusBadge, formatDateTime, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

const KINDS: GameKind[] = ['regular', 'scrimmage', 'playoff', 'bye', 'other'];
const LOCATIONS: GameLocation[] = ['home', 'away', 'neutral'];
const STATUSES: GameStatus[] = ['scheduled', 'rescheduled', 'postponed', 'canceled', 'final'];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function GameEditor({ game, onDone }: { game: ScheduledGame; onDone: () => void }) {
  const api = useApi();
  const ws = useWorkspace();
  const id = useId();
  const [status, setStatus] = useState<GameStatus>(game.status);
  const [our, setOur] = useState(game.result?.ourScore?.toString() ?? '');
  const [their, setTheir] = useState(game.result?.theirScore?.toString() ?? '');
  const [when, setWhen] = useState(toLocalInput(game.scheduledAt));
  const [notes, setNotes] = useState(game.notes);
  const [formError, setFormError] = useState<string | null>(null);
  const save = useAction(async () => {
    let result: ScheduledGame['result'] = game.result;
    if (status === 'final') {
      const o = Number(our);
      const t = Number(their);
      if (our === '' || their === '' || Number.isNaN(o) || Number.isNaN(t)) throw new Error('A final game needs both scores.');
      result = { ourScore: o, theirScore: t, outcome: o > t ? 'win' : o < t ? 'loss' : 'tie' };
    } else if (status !== game.status) {
      result = null;
    }
    const updated = await api.seasons.updateGame(game.id, { status, result, scheduledAt: fromLocalInput(when), notes, expectedVersion: game.version });
    ws.reload();
    onDone();
    return updated;
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    void save.run();
  }

  return (
    <form className="inline-editor" onSubmit={submit} aria-label={`Edit ${ws.gameLabel(game)}`}>
      <div className="field-grid">
        <label htmlFor={`${id}-status`}>
          Status
          <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as GameStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-when`}>
          Kickoff
          <input id={`${id}-when`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        {status === 'final' ? (
          <>
            <label htmlFor={`${id}-our`}>
              Our score
              <input id={`${id}-our`} type="number" min={0} value={our} onChange={(e) => setOur(e.target.value)} required />
            </label>
            <label htmlFor={`${id}-their`}>
              Their score
              <input id={`${id}-their`} type="number" min={0} value={their} onChange={(e) => setTheir(e.target.value)} required />
            </label>
          </>
        ) : null}
        <label htmlFor={`${id}-notes`} className="span-2">
          Notes
          <input id={`${id}-notes`} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {formError ? <p className="field-error">{formError}</p> : null}
      <div className="btn-row">
        <button type="submit" className="primary" disabled={save.status === 'saving'}>
          Save changes
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <SaveStatus status={save.status} error={save.error} />
      </div>
    </form>
  );
}

function AddGameForm() {
  const api = useApi();
  const ws = useWorkspace();
  const id = useId();
  const [week, setWeek] = useState('');
  const [kind, setKind] = useState<GameKind>('regular');
  const [opponentId, setOpponentId] = useState('');
  const [location, setLocation] = useState<GameLocation | ''>('home');
  const [when, setWhen] = useState('');
  const add = useAction(async () => {
    if (!ws.team || !ws.season) throw new Error('Pick a team and season first.');
    const created = await api.seasons.createGame(ws.team.id, ws.season.id, {
      week: week === '' ? null : Number(week),
      kind,
      opponentId: kind === 'bye' ? null : opponentId || null,
      location: kind === 'bye' ? null : location || null,
      scheduledAt: fromLocalInput(when),
      notes: '',
    });
    setWeek('');
    setOpponentId('');
    setWhen('');
    ws.reload();
    return created;
  });

  return (
    <form
      className="card tight"
      onSubmit={(e) => {
        e.preventDefault();
        void add.run();
      }}
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`}>Add a game</h2>
      <div className="field-grid">
        <label htmlFor={`${id}-week`}>
          Week
          <input id={`${id}-week`} type="number" min={0} value={week} onChange={(e) => setWeek(e.target.value)} />
        </label>
        <label htmlFor={`${id}-kind`}>
          Kind
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as GameKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'bye' ? (
          <>
            <label htmlFor={`${id}-opp`}>
              Opponent
              <select id={`${id}-opp`} value={opponentId} onChange={(e) => setOpponentId(e.target.value)}>
                <option value="">Not set</option>
                {ws.opponents.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-loc`}>
              Location
              <select id={`${id}-loc`} value={location} onChange={(e) => setLocation(e.target.value as GameLocation | '')}>
                <option value="">Not set</option>
                {LOCATIONS.map((l) => (
                  <option key={l} value={l}>
                    {humanize(l)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label htmlFor={`${id}-when`}>
          Kickoff
          <input id={`${id}-when`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
      </div>
      <div className="btn-row">
        <button type="submit" className="primary" disabled={add.status === 'saving'}>
          Add game
        </button>
        <SaveStatus status={add.status} error={add.error} savedText="Game added" />
      </div>
    </form>
  );
}

function ImportPanel() {
  const api = useApi();
  const ws = useWorkspace();
  const id = useId();
  const [text, setText] = useState('week,opponent,location,date\n');
  const [preview, setPreview] = useState<ScheduleImport | null>(null);
  const previewAction = useAction(async () => {
    if (!ws.team || !ws.season) throw new Error('Pick a team and season first.');
    const result = await api.seasons.previewImport(ws.team.id, ws.season.id, { name: 'pasted.csv', text });
    setPreview(result);
    return result;
  });
  const applyAction = useAction(async () => {
    if (!preview) return [];
    const created = await api.seasons.applyImport(preview.id);
    setPreview(null);
    ws.reload();
    return created;
  });

  return (
    <details className="card tight import-panel">
      <summary>
        <h2>Import a schedule (preview first)</h2>
      </summary>
      <p className="small muted">
        Paste CSV with the columns <code>week, opponent, location, date</code>. Nothing is saved until you apply the preview. Rows with problems are listed and block the apply.
      </p>
      <label htmlFor={`${id}-csv`}>CSV rows</label>
      <textarea id={`${id}-csv`} value={text} onChange={(e) => setText(e.target.value)} rows={5} spellCheck={false} />
      <div className="btn-row">
        <button type="button" onClick={() => void previewAction.run()} disabled={previewAction.status === 'saving'}>
          Preview
        </button>
        <SaveStatus status={previewAction.status} error={previewAction.error} savedText="Preview ready" />
      </div>
      {preview ? (
        <div className="import-preview" aria-live="polite">
          <p>
            <strong>{preview.rowCount}</strong> row{preview.rowCount === 1 ? '' : 's'} read from <code>{preview.filename}</code>; <strong>{preview.errors.length}</strong> problem
            {preview.errors.length === 1 ? '' : 's'}.
          </p>
          {preview.errors.length ? (
            <ul className="small field-error-list" role="alert">
              {preview.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Opponent</th>
                  <th>Location</th>
                  <th>Kickoff</th>
                </tr>
              </thead>
              <tbody>
                {(preview.previewRows ?? []).map((r, i) => (
                  <tr key={i}>
                    <td>{r.week ?? '—'}</td>
                    <td>{r.opponentName ?? (r.kind === 'bye' ? 'Bye' : '—')}</td>
                    <td>{r.location ? humanize(r.location) : '—'}</td>
                    <td>{formatDateTime(r.scheduledAt ?? null, ws.team?.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <button type="button" className="primary" disabled={preview.errors.length > 0 || applyAction.status === 'saving'} onClick={() => void applyAction.run()}>
              Apply {preview.rowCount} game{preview.rowCount === 1 ? '' : 's'}
            </button>
            <button type="button" onClick={() => setPreview(null)}>
              Discard preview
            </button>
            <SaveStatus status={applyAction.status} error={applyAction.error} savedText="Schedule imported" />
          </div>
        </div>
      ) : null}
    </details>
  );
}

export function SchedulePage() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);
  const record = seasonRecord(ws.games);
  const games = [...ws.games].sort((a, b) => (a.week ?? 99) - (b.week ?? 99));

  return (
    <>
      <PageHeader
        title="Schedule"
        lede={
          <>
            {ws.season?.label} season · <strong>{record.wins}–{record.losses}{record.ties ? `–${record.ties}` : ''}</strong>, counted from final games only (byes and canceled games excluded).
          </>
        }
      />
      {games.length === 0 ? (
        <EmptyState title="No games on this season yet." />
      ) : (
        <div className="table-scroll">
          <table className="schedule-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Opponent</th>
                <th scope="col">Kickoff</th>
                <th scope="col">Where</th>
                <th scope="col">Status</th>
                <th scope="col">Result</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <Fragment key={g.id}>
                  <tr className={ws.game?.id === g.id ? 'current' : undefined} aria-current={ws.game?.id === g.id ? 'true' : undefined}>
                    <td>{g.week ?? (g.kind === 'playoff' ? 'Playoff' : '—')}</td>
                    <td>
                      {g.kind === 'bye' ? 'Bye' : g.opponentId ? ws.opponentName(g.opponentId) : g.kind === 'playoff' ? 'TBD (bracket)' : 'Not set'}
                      {g.notes ? <span className="small muted block">{g.notes}</span> : null}
                    </td>
                    <td>{g.kind === 'bye' ? '—' : formatDateTime(g.scheduledAt, ws.team?.timezone)}</td>
                    <td>{g.location ? humanize(g.location) : '—'}</td>
                    <td>{g.kind === 'bye' ? '—' : <StatusBadge value={g.status} />}</td>
                    <td>
                      {g.result ? (
                        <>
                          <StatusBadge value={g.result.outcome} label={g.result.outcome.toUpperCase()} /> {g.result.ourScore}–{g.result.theirScore}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="btn-row">
                        {g.kind !== 'bye' ? (
                          <button type="button" className="link" onClick={() => setEditing(editing === g.id ? null : g.id)} aria-expanded={editing === g.id}>
                            {editing === g.id ? 'Close' : 'Edit'}
                          </button>
                        ) : null}
                        {ws.game?.id !== g.id && g.kind !== 'bye' ? (
                          <button type="button" className="link" onClick={() => ws.select({ game: g.id })}>
                            Open
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {editing === g.id ? (
                    <tr className="editor-row">
                      <td colSpan={7}>
                        <GameEditor game={g} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="two-up">
        <AddGameForm />
        <ImportPanel />
      </div>
    </>
  );
}
