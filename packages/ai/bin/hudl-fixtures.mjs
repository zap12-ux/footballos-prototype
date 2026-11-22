#!/usr/bin/env node
/**
 * Derive anonymized test fixtures from a Hudl breakdown export (CSV).
 *
 *   node packages/ai/bin/hudl-fixtures.mjs --csv <hudl-export.csv> --out packages/ai/test/fixtures/hudl
 *
 * The raw export is owner-provided and never committed (see test/fixtures/hudl/README.md).
 * Everything written here is derived: identifiers are salted hashes, opponents are renamed
 * "Opponent A/B/C" in order of first appearance, athlete ids and jersey numbers are dropped,
 * and clip offsets are synthetic (clips laid end to end per asset). Output is deterministic
 * for a given input, salt and seed, so regenerating produces identical bytes.
 *
 * Outputs:
 *   coach.jsonl        truth rows for the evaluation harness (segmentId, gameId, key, value)
 *   predictions.jsonl  synthetic model output: a seeded degradation of the truth (see README)
 *   bundle.json        team, opponents, games, assets and segments in the shapes the
 *                      scouting report and statistics take
 *   summary.json       row counts by game and side, for the README (tests do not read it)
 *
 * No dependencies: a small RFC 4180 parser and node:crypto only.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Arguments -----------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { csv: null, out: null, salt: "footballos-hudl-fixture-v1", seed: "hudl-predictions-v1" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--csv") out.csv = next();
    else if (a === "--out") out.out = next();
    else if (a === "--salt") out.salt = next();
    else if (a === "--seed") out.seed = next();
    else if (a === "--help" || a === "-h") {
      console.log("usage: hudl-fixtures.mjs --csv <export.csv> --out <dir> [--salt s] [--seed s]");
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!out.csv) throw new Error("--csv is required");
  if (!out.out) throw new Error("--out is required");
  return out;
}

// CSV -----------------------------------------------------------------------------------------

/** RFC 4180: quoted fields may contain commas, newlines and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// Identifiers --------------------------------------------------------------------------------

/** Deterministic UUID (RFC 9562 v8 layout) from a sha256 of the parts; valid for IdSchema. */
export function stableId(salt, ...parts) {
  const h = createHash("sha256").update([salt, ...parts].join("\u0000")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Seeded random (mulberry32 over a string seed) -----------------------------------------------

function rng(seed) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hudl → label values -------------------------------------------------------------------------

const HASH = { L: "left", M: "middle", R: "right" };
const SPECIAL = {
  KO: "kickoff",
  "Onside Kick": "kickoff",
  Punt: "punt",
  "Extra Pt.": "fg_pat",
  "2 Pt.": "fg_pat",
  "Extra Pt. Block": "fg_pat",
  FG: "fg_pat",
  "KO Rec": "return",
  "Punt Rec": "return",
};

function fieldPosition(yardLn) {
  if (yardLn === "") return null;
  const n = Number(yardLn);
  if (!Number.isFinite(n)) return null;
  if (n === 50 || n === -50) return "50";
  return n < 0 ? `own ${-n}` : `opp ${n}`;
}

function nullIfEmpty(v) {
  return v === "" ? null : v;
}

/** Labels for one play as the coach would have accepted them: unit, play type, situation, hash, motion, special teams. */
function truthFor(row, side) {
  const t = {};
  if (side === "special_teams") {
    t.unit = "special_teams";
    t.play_type = row.play_type === "" ? null : "other";
    t.special_teams_type = SPECIAL[row.play_type] ?? null;
    t.formation_family = null;
  } else {
    t.unit = "offense";
    t.play_type = row.play_type === "Run" ? "run" : row.play_type === "Pass" ? "pass" : null;
    t.formation_family = row.off_form === "" ? null : row.off_form.toLowerCase();
  }
  t.situation_down = /^[1-4]$/.test(row.dn) ? row.dn : null;
  t.situation_distance = /^\d+$/.test(row.dist) ? row.dist : null;
  t.situation_field_position = fieldPosition(row.yard_ln);
  t.hash = HASH[row.hash] ?? null;
  // Hudl leaves motion blank both for "no motion" and "not tagged"; only a tagged direction is known.
  t.motion = row.motion_dir === "" ? null : "yes";
  return t;
}

/** Hudl ODK → which film this play belongs to. "S" rows (no play data) are skipped. */
function sideOf(odk) {
  switch (odk) {
    case "O":
      return "our_offense";
    case "D":
      return "opponent_offense";
    case "K":
      return "special_teams";
    default:
      return null;
  }
}

const ASSET_CONTEXT = {
  our_offense: { analyzedTeam: "us", analyzedUnit: "offense" },
  opponent_offense: { analyzedTeam: "opponent", analyzedUnit: "offense" },
  special_teams: { analyzedTeam: "us", analyzedUnit: "special_teams" },
};

// Synthetic predictions -----------------------------------------------------------------------

/** Per-key shares of correct / abstained / wrong among rows with a known truth value. */
const DEGRADATION = {
  unit: [0.97, 0.02, 0.01],
  play_type: [0.88, 0.07, 0.05],
  formation_family: [0.7, 0.2, 0.1],
  hash: [0.85, 0.1, 0.05],
  motion: [0.8, 0.15, 0.05],
  special_teams_type: [0.9, 0.08, 0.02],
  // Evidence-only keys: a model may fill them only from a visible marker; never wrong here.
  situation_down: [0.3, 0.7, 0],
  situation_distance: [0.2, 0.8, 0],
  situation_field_position: [0.2, 0.8, 0],
};
/** Share of truth rows with no prediction row at all ("missing" in the harness). */
const MISSING_SHARE = 0.02;

function degrade(truth, seed) {
  const random = rng(seed);
  const vocab = new Map();
  for (const r of truth) {
    if (r.value === null) continue;
    if (!vocab.has(r.key)) vocab.set(r.key, new Set());
    vocab.get(r.key).add(r.value);
  }
  const out = [];
  for (const r of truth) {
    if (random() < MISSING_SHARE) continue;
    const values = [...(vocab.get(r.key) ?? [])].sort();
    if (r.value === null) {
      // Unscored by the harness: abstain mostly, otherwise guess something plausible.
      if (random() < 0.6 || values.length === 0) out.push({ ...r, value: null, abstained: true });
      else out.push({ ...r, value: values[Math.floor(random() * values.length)], abstained: false });
      continue;
    }
    const [pCorrect, pAbstain] = DEGRADATION[r.key] ?? [0.8, 0.1, 0.1];
    const x = random();
    if (x < pCorrect) out.push({ ...r, abstained: false });
    else if (x < pCorrect + pAbstain) out.push({ ...r, value: null, abstained: true });
    else {
      const others = values.filter((v) => v !== r.value);
      if (others.length === 0) out.push({ ...r, value: null, abstained: true });
      else out.push({ ...r, value: others[Math.floor(random() * others.length)], abstained: false });
    }
  }
  return out;
}

// Main ----------------------------------------------------------------------------------------

export function convert(rows, { salt, seed }) {
  const teamId = stableId(salt, "team");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Games in date order; opponents lettered by first appearance.
  const byVideo = new Map();
  for (const r of rows) {
    if (!byVideo.has(r.video_id)) byVideo.set(r.video_id, { date: r.game_date, opponentName: r.opponent, rows: [] });
    byVideo.get(r.video_id).rows.push(r);
  }
  const videos = [...byVideo.entries()].sort((a, b) => a[1].date.localeCompare(b[1].date) || a[0].localeCompare(b[0]));
  const opponents = [];
  const opponentIdByName = new Map();
  for (const [, v] of videos) {
    if (!opponentIdByName.has(v.opponentName)) {
      const name = `Opponent ${letters[opponents.length] ?? opponents.length}`;
      const id = stableId(salt, "opponent", v.opponentName);
      opponentIdByName.set(v.opponentName, id);
      opponents.push({ id, name });
    }
  }

  const games = [];
  const assets = [];
  const segments = [];
  const truth = [];
  const summary = { games: [], skippedRows: 0 };

  videos.forEach(([videoId, v], weekIndex) => {
    const gameId = stableId(salt, "game", videoId);
    const opponentId = opponentIdByName.get(v.opponentName);
    games.push({ id: gameId, opponentId, date: v.date, week: weekIndex + 1 });
    const counts = { our_offense: 0, opponent_offense: 0, special_teams: 0 };
    const clock = { our_offense: 0, opponent_offense: 0, special_teams: 0 };
    const assetIds = {};
    for (const side of Object.keys(ASSET_CONTEXT)) {
      assetIds[side] = stableId(salt, "asset", videoId, side);
      assets.push({ id: assetIds[side], gameId, side, ...ASSET_CONTEXT[side] });
    }
    const plays = [...v.rows].sort((a, b) => Number(a.play_num) - Number(b.play_num));
    for (const r of plays) {
      const side = sideOf(r.odk);
      if (side === null) {
        summary.skippedRows++;
        continue;
      }
      const seconds = Math.max(1, Math.round(Number(r.duration_ms) || 0) / 1000);
      const startSec = Math.round(clock[side] * 1000) / 1000;
      const endSec = Math.round((clock[side] + seconds) * 1000) / 1000;
      clock[side] = endSec;
      const id = stableId(salt, "segment", r.clip_id);
      segments.push({
        id,
        gameId,
        assetId: assetIds[side],
        side,
        index: counts[side]++,
        startSec,
        endSec,
        meta: {
          quarter: nullIfEmpty(r.qtr),
          playNumber: Number(r.play_num),
          result: nullIfEmpty(r.result),
          gainYards: /^-?\d+$/.test(r.gn_ls) ? Number(r.gn_ls) : null,
          efficient: r.eff === "Y" ? true : r.eff === "N" ? false : null,
          series: nullIfEmpty(r.series),
          hudlPlayType: nullIfEmpty(r.play_type),
        },
      });
      for (const [key, value] of Object.entries(truthFor(r, side))) truth.push({ segmentId: id, gameId, key, value });
    }
    summary.games.push({ gameId, week: weekIndex + 1, opponent: opponents.find((o) => o.id === opponentId).name, ...counts });
  });

  const predictions = degrade(truth, seed);
  return { bundle: { teamId, opponents, games, assets, segments }, truth, predictions, summary };
}

function main(argv) {
  const args = parseArgs(argv);
  const rows = parseCsv(readFileSync(args.csv, "utf8"));
  const required = ["game_date", "opponent", "video_id", "clip_id", "duration_ms", "play_num", "odk", "dn", "dist", "yard_ln", "hash", "off_form", "play_type", "motion_dir"];
  const missing = required.filter((c) => !(c in (rows[0] ?? {})));
  if (missing.length > 0) throw new Error(`CSV is missing columns: ${missing.join(", ")}`);

  const { bundle, truth, predictions, summary } = convert(rows, args);
  mkdirSync(args.out, { recursive: true });
  const jsonl = (items) => items.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(args.out, "coach.jsonl"), jsonl(truth));
  writeFileSync(join(args.out, "predictions.jsonl"), jsonl(predictions));
  writeFileSync(join(args.out, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
  writeFileSync(join(args.out, "summary.json"), JSON.stringify({ ...summary, truthRows: truth.length, predictionRows: predictions.length, segments: bundle.segments.length }, null, 2) + "\n");
  console.log(`wrote ${bundle.segments.length} segments, ${truth.length} truth rows, ${predictions.length} prediction rows to ${args.out}`);
  for (const g of summary.games) console.log(`  week ${g.week} vs ${g.opponent}: our offense ${g.our_offense}, opponent offense ${g.opponent_offense}, special teams ${g.special_teams}`);
  if (summary.skippedRows > 0) console.log(`  skipped ${summary.skippedRows} rows without play data (ODK "S")`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
