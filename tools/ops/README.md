# @footballos/ops

Operations tooling owned by Deployment / Reliability (role F). Currently: SQLite online
backup and verified restore (`src/sqlite-backup.mjs`), used through `scripts/backup-sqlite.mjs`
and `scripts/restore-sqlite.mjs`. Usage and the drill record are in `deploy/README.md`.

`npm test -w tools/ops` runs the tests against temporary databases.
