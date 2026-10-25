import type { ImportRowError, PlayerStatus, RosterImportField, RosterImportRow } from '@footballos/contracts';
import { parseCsv } from './csv.js';

/** Header auto-mapping for roster CSVs (§15.2); shares the CSV parser with schedule imports. */
const HEADER_SYNONYMS: Record<Exclude<RosterImportField, 'ignore'>, string[]> = {
  jersey: ['jersey', 'number', 'no', 'no.', '#', 'num', 'jersey #', 'jersey number'],
  first: ['first', 'first name', 'firstname', 'given name', 'fname'],
  last: ['last', 'last name', 'lastname', 'surname', 'family name', 'lname'],
  name: ['name', 'player', 'player name', 'full name', 'athlete'],
  positions: ['position', 'positions', 'pos', 'pos.', 'role'],
  class: ['class', 'class year', 'year', 'grade', 'yr', 'eligibility'],
  status: ['status', 'availability', 'active'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
};

export function detectRosterMapping(headers: string[]): Record<string, RosterImportField> {
  const mapping: Record<string, RosterImportField> = {};
  const taken = new Set<RosterImportField>();
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    let target: RosterImportField = 'ignore';
    for (const [field, names] of Object.entries(HEADER_SYNONYMS) as [RosterImportField, string[]][]) {
      if (!taken.has(field) && names.includes(key)) { target = field; break; }
    }
    if (target !== 'ignore') taken.add(target);
    mapping[h] = target;
  }
  return mapping;
}

function parseStatus(raw: string): PlayerStatus | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (s === '' || ['active', 'available', 'yes', 'y', 'true', 'healthy'].includes(s)) return 'active';
  if (['injured', 'inj', 'hurt'].includes(s)) return 'injured';
  if (['unavailable', 'out', 'suspended', 'ineligible'].includes(s)) return 'unavailable';
  if (['inactive', 'no', 'n', 'false', 'left', 'quit'].includes(s)) return 'inactive';
  return 'invalid';
}

const CLASS_ALIASES: Record<string, string> = { freshman: 'FR', fr: 'FR', '9': 'FR', sophomore: 'SO', so: 'SO', '10': 'SO', junior: 'JR', jr: 'JR', '11': 'JR', senior: 'SR', sr: 'SR', '12': 'SR' };

export type RosterPreview = { mapping: Record<string, RosterImportField>; rowCount: number; rows: RosterImportRow[]; errors: ImportRowError[] };

/** Parses roster CSV text into validated rows and per-row errors. Nothing is written. */
export function previewRoster(content: string, explicitMapping?: Record<string, RosterImportField>): RosterPreview {
  const table = parseCsv(content);
  if (table.length === 0) return { mapping: {}, rowCount: 0, rows: [], errors: [{ row: 1, column: null, message: 'file is empty' }] };
  const headers = table[0]!.map((h) => h.trim());
  const mapping = explicitMapping ?? detectRosterMapping(headers);
  const colFor = (field: RosterImportField): number => headers.findIndex((h) => mapping[h] === field);
  const errors: ImportRowError[] = [];
  const rows: RosterImportRow[] = [];
  if (colFor('name') < 0 && (colFor('first') < 0 || colFor('last') < 0)) {
    errors.push({ row: 1, column: null, message: `could not find name columns (first + last, or name) in headers: ${headers.join(', ')}` });
    return { mapping, rowCount: table.length - 1, rows, errors };
  }
  const seenJersey = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const rowNo = i;
    const cell = (field: RosterImportField) => { const c = colFor(field); return c >= 0 ? (cells[c] ?? '').trim() : ''; };
    const header = (field: RosterImportField) => { const c = colFor(field); return c >= 0 ? headers[c]! : null; };
    let rowErrors = 0;
    const err = (field: RosterImportField | null, message: string) => { errors.push({ row: rowNo, column: field ? header(field) : null, message }); rowErrors++; };

    let firstName = cell('first');
    let lastName = cell('last');
    if (colFor('name') >= 0 && (!firstName || !lastName)) {
      const full = cell('name');
      if (full.includes(',')) { const [l, f] = full.split(',', 2); lastName = (l ?? '').trim(); firstName = (f ?? '').trim(); }
      else { const parts = full.split(/\s+/).filter(Boolean); firstName = parts.slice(0, -1).join(' '); lastName = parts[parts.length - 1] ?? ''; if (parts.length === 1) { firstName = parts[0]!; lastName = ''; } }
    }
    if (!firstName) err(colFor('first') >= 0 ? 'first' : 'name', 'first name is required');
    if (!lastName) err(colFor('last') >= 0 ? 'last' : 'name', 'last name is required');
    if (firstName.length > 80 || lastName.length > 80) err('name', 'name longer than 80 characters');

    let jersey: string | null = cell('jersey') || null;
    if (jersey !== null) {
      jersey = jersey.replace(/^#/, '');
      if (!/^[0-9]{1,2}[A-Za-z]?$|^[0-9]{1,3}$/.test(jersey) || jersey.length > 4) { err('jersey', `jersey "${jersey}" is not a number of up to 3 digits`); jersey = null; }
      else {
        const prev = seenJersey.get(jersey);
        if (prev !== undefined) err('jersey', `jersey ${jersey} already used by row ${prev}`);
        else seenJersey.set(jersey, rowNo);
      }
    }
    const positions = cell('positions').split(/[\/,;|\s]+/).map((p) => p.trim().toUpperCase()).filter(Boolean);
    if (positions.some((p) => p.length > 16)) err('positions', 'a position code is longer than 16 characters');
    const classRaw = cell('class');
    const classYear = CLASS_ALIASES[classRaw.toLowerCase()] ?? classRaw.slice(0, 16);
    let status = parseStatus(cell('status'));
    if (status === 'invalid') { err('status', `unknown status "${cell('status')}"`); status = 'active'; }

    if (rowErrors === 0) rows.push({ row: rowNo, jersey, firstName, lastName, positions, classYear, status, notes: cell('notes'), matchesPlayerId: null });
  }
  return { mapping, rowCount: table.length - 1, rows, errors };
}
