import type { GameKind, GameLocation, ImportRowError, ScheduleImportField, ScheduleImportRow } from '@footballos/contracts';
import { parseCsv } from './csv.js';
import { parseDateCell, parseTimeCell, zonedToUtcIso } from './time.js';

const HEADER_SYNONYMS: Record<Exclude<ScheduleImportField, 'ignore'>, string[]> = {
  week: ['week', 'wk', 'game', 'game #', 'game number', '#'],
  date: ['date', 'game date', 'day'],
  time: ['time', 'kickoff', 'kick', 'start', 'start time'],
  opponent: ['opponent', 'opp', 'vs', 'versus', 'against', 'team'],
  location: ['location', 'site', 'home/away', 'h/a', 'venue', 'where', 'loc'],
  kind: ['kind', 'type', 'game type', 'category'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
};

export function detectMapping(headers: string[]): Record<string, ScheduleImportField> {
  const mapping: Record<string, ScheduleImportField> = {};
  const taken = new Set<ScheduleImportField>();
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    let target: ScheduleImportField = 'ignore';
    for (const [field, names] of Object.entries(HEADER_SYNONYMS) as [ScheduleImportField, string[]][]) {
      if (!taken.has(field) && names.includes(key)) { target = field; break; }
    }
    if (target !== 'ignore') taken.add(target);
    mapping[h] = target;
  }
  return mapping;
}

function parseLocation(raw: string): GameLocation | null | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  if (['home', 'h', 'vs', 'vs.'].includes(s)) return 'home';
  if (['away', 'a', '@', 'at'].includes(s)) return 'away';
  if (['neutral', 'n'].includes(s)) return 'neutral';
  return 'invalid';
}

function parseKind(raw: string): GameKind | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (s === '' || ['regular', 'conference', 'non-conference', 'nonconference', 'league', 'district', 'region'].includes(s)) return 'regular';
  if (['bye', 'open', 'off'].includes(s)) return 'bye';
  if (['scrimmage', 'jamboree', 'preseason'].includes(s)) return 'scrimmage';
  if (['playoff', 'playoffs', 'postseason', 'round 1', 'semifinal', 'final', 'championship'].includes(s)) return 'playoff';
  if (s === 'other') return 'other';
  return 'invalid';
}

export type PreviewResult = {
  mapping: Record<string, ScheduleImportField>;
  rowCount: number;
  rows: ScheduleImportRow[];
  errors: ImportRowError[];
};

/** Parses CSV text into validated rows and per-row errors. Nothing is written. */
export function previewSchedule(content: string, timezone: string, explicitMapping?: Record<string, ScheduleImportField>): PreviewResult {
  const table = parseCsv(content);
  if (table.length === 0) return { mapping: {}, rowCount: 0, rows: [], errors: [{ row: 1, column: null, message: 'file is empty' }] };
  const headers = table[0]!.map((h) => h.trim());
  const mapping = explicitMapping ?? detectMapping(headers);
  const colFor = (field: ScheduleImportField): number => headers.findIndex((h) => mapping[h] === field);
  const errors: ImportRowError[] = [];
  const rows: ScheduleImportRow[] = [];
  const missing = (['opponent', 'date'] as const).filter((f) => colFor(f) < 0);
  if (colFor('opponent') < 0 && colFor('kind') < 0) {
    errors.push({ row: 1, column: null, message: `could not find an opponent column (headers: ${headers.join(', ')})` });
    return { mapping, rowCount: table.length - 1, rows, errors };
  }
  const seenWeeks = new Map<number, number>();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const rowNo = i;
    const cell = (field: ScheduleImportField) => { const c = colFor(field); return c >= 0 ? (cells[c] ?? '').trim() : ''; };
    const header = (field: ScheduleImportField) => { const c = colFor(field); return c >= 0 ? headers[c]! : null; };
    let rowErrors = 0;
    const err = (field: ScheduleImportField | null, message: string) => { errors.push({ row: rowNo, column: field ? header(field) : null, message }); rowErrors++; };

    let week: number | null = null;
    const weekRaw = cell('week');
    if (weekRaw !== '') {
      const n = Number(weekRaw.replace(/^(week|wk)\s*/i, ''));
      if (!Number.isInteger(n) || n < 0 || n > 52) err('week', `week "${weekRaw}" is not a whole number between 0 and 52`);
      else week = n;
    }

    const opponentRaw = cell('opponent');
    let kind = parseKind(cell('kind'));
    if (kind === 'invalid') { err('kind', `unknown game type "${cell('kind')}"`); kind = 'regular'; }
    if (kind !== 'bye' && /^(bye|open)$/i.test(opponentRaw)) kind = 'bye';
    const opponentName = kind === 'bye' ? null : opponentRaw || null;
    if (kind !== 'bye' && !opponentName) err('opponent', 'opponent is required');

    const locParsed = parseLocation(cell('location'));
    const location = locParsed === 'invalid' ? null : locParsed;
    if (locParsed === 'invalid') err('location', `location "${cell('location')}" is not home/away/neutral`);

    let scheduledAt: string | null = null;
    const dateRaw = cell('date');
    if (dateRaw !== '') {
      const d = parseDateCell(dateRaw);
      if (!d) err('date', `unparseable date "${dateRaw}" (use YYYY-MM-DD or M/D/YYYY)`);
      else {
        const timeRaw = cell('time');
        let t = { h: 0, min: 0 };
        if (timeRaw !== '') {
          const parsed = parseTimeCell(timeRaw);
          if (!parsed) err('time', `unparseable time "${timeRaw}"`);
          else t = parsed;
        }
        scheduledAt = zonedToUtcIso(d, t, timezone);
      }
    } else if (missing.includes('date') && i === 1) {
      // no date column at all: allowed, games stay unscheduled (scheduledAt null)
    }

    if (week !== null) {
      const prev = seenWeeks.get(week);
      if (prev !== undefined) err('week', `week ${week} already used by row ${prev}`);
      else seenWeeks.set(week, rowNo);
    }

    if (rowErrors === 0) rows.push({ row: rowNo, week, kind, opponentName, location, scheduledAt, notes: cell('notes') });
  }
  return { mapping, rowCount: table.length - 1, rows, errors };
}
