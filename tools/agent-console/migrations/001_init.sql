-- Agent Build Console schema v1. One statement per block; applied once and recorded in schema_migrations.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('live', 'fixture')),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  worktree TEXT,
  branch TEXT,
  runtime_agent_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  self_state TEXT NOT NULL DEFAULT 'not_started',
  runtime_state TEXT CHECK (runtime_state IN ('completed', 'failed')),
  current_task_id TEXT,
  blocked_by_task_id TEXT,
  last_agent_update_at TEXT,
  last_runtime_update_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_run_idx ON agents(run_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  agent_id TEXT,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  allowed_paths_json TEXT NOT NULL DEFAULT '[]',
  branch TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'in_progress', 'ready_for_review', 'integrated', 'verified', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_run_idx ON tasks(run_id);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL REFERENCES runs(id),
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('agent', 'runtime', 'owner', 'lead', 'system')),
  agent_id TEXT,
  task_id TEXT,
  question_id TEXT,
  response_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  client_event_id TEXT
);
CREATE INDEX IF NOT EXISTS events_run_seq_idx ON events(run_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS events_agent_client_idx
  ON events(agent_id, client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  options_json TEXT,
  recommendation TEXT,
  blocking INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'superseded', 'expired', 'canceled')),
  supersedes_question_id TEXT,
  superseded_by_question_id TEXT,
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS questions_run_status_idx ON questions(run_id, status);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  question_version INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  text TEXT,
  option TEXT,
  state TEXT NOT NULL DEFAULT 'submitted'
    CHECK (state IN ('submitted', 'delivered', 'acknowledged')),
  client_request_id TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  delivered_at TEXT,
  delivered_via TEXT CHECK (delivered_via IN ('agent_poll', 'lead_continuation')),
  acknowledged_at TEXT,
  ack_event_seq INTEGER,
  ack_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (question_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS responses_question_idx ON responses(question_id);

CREATE TABLE IF NOT EXISTS task_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  summary TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  tests_run_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  follow_ups_json TEXT NOT NULL DEFAULT '[]',
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tests', 'integration_merge', 'browser', 'git', 'manual')),
  command TEXT,
  result_summary TEXT NOT NULL,
  passed INTEGER NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  question_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
