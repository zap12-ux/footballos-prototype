# FootballOS deployment (single host)

Status: **nothing here has been provisioned or deployed.** The SQLite backup and restore
tools (`scripts/backup-sqlite.mjs`, `scripts/restore-sqlite.mjs`) are tested and have been
drilled locally on a synthetic database (see below). The API package (`apps/api`) does not
exist on `integration` yet, so the service unit, release and rollback steps, and a full
application restore are still unverified.

FootballOS serves one coaching staff. One host runs everything: Node 22, the API with its
background worker, SQLite, and media files on local disk. There are no separate database
servers, queues or container platforms to operate.

## Layout on the host

```
/opt/footballos/
  releases/<git-sha>/        # one directory per deployed release (built source + node_modules)
  current -> releases/<sha>  # symlink the service runs from
/var/lib/footballos/         # FOOTBALLOS_DATA_DIR, on the attached persistent volume
  footballos.db              # SQLite (WAL mode)
  media/                     # originals, proxies, thumbnails (private; never web-served directly)
  backups/                   # local staging for the nightly backup before off-host upload
/etc/footballos/api.env      # copied from deploy/env/api.env.example, mode 0600, owner footballos
```

Environment templates: [`env/api.env.example`](env/api.env.example) and
[`env/console.env.example`](env/console.env.example). Secrets are entered on the host only,
never committed. Development and production use separate data directories and separate API
keys; the production data directory must never be mounted by a development machine or agent.

## Hosting (decision D-009: DigitalOcean)

The owner chose **DigitalOcean** on 2026-10-25. That is a provider choice only: creating
the account, provisioning, payment, deployment and moving team film to it each still need
separate explicit approval from the owner.

The plan: **one small VM with an attached persistent volume
for `FOOTBALLOS_DATA_DIR`, and nightly off-host backups to object storage in the same
provider.** Each option below is priced for the same reference configuration: 2 vCPU / 4 GB
server, 100 GB volume, 200 GB object storage. Prices were read from each provider's official
pricing pages on 2026-10-25, exclude tax, and must be rechecked before provisioning.

| | DigitalOcean | Akamai Cloud (Linode) | Hetzner Cloud |
| --- | --- | --- | --- |
| Server | Basic Droplet 2 vCPU / 4 GiB / 80 GiB / 4,000 GiB transfer: **$24.00** | Shared Linode 4 GB, 2 vCPU / 80 GB / 4 TB transfer: **$24.00** | No 2 vCPU / 4 GB plan in US sites. Nearest US plan: CPX21, 3 vCPU / 4 GB / 80 GB: **€32.49** |
| 100 GB volume | $0.10/GiB: **$10.00** | $0.10/GB: **$10.00** (rate shown for one region; confirm for a US region) | Not verified |
| 200 GB object storage | Spaces $5 base incl. 250 GiB + 1 TiB egress: **$5.00** | $5 flat incl. 250 GB + 1 TB egress: **$5.00** | €6.49 base incl. 1 TB, **EU locations only** (no US) |
| **Estimate / month** | **$39.00** | **$39.00** | Incomplete; backups would leave the US |
| Sources | [droplets](https://www.digitalocean.com/pricing/droplets), [volumes](https://www.digitalocean.com/pricing/volumes), [spaces](https://www.digitalocean.com/pricing/spaces-object-storage) | [cpu](https://www.akamai.com/cloud/pricing/cpu), [block storage](https://www.akamai.com/cloud/pricing/block-storage), [object storage](https://www.akamai.com/cloud/pricing/object-storage) | [regular performance](https://www.hetzner.com/cloud/regular-performance), [object storage](https://www.hetzner.com/storage/object-storage) |

DigitalOcean and Akamai cost the same for this configuration, and both offer US regions
for server, volume and backups in one account. DigitalOcean's optional
weekly server backups add 20% of the Droplet price ($4.80). Hetzner is listed for
completeness, but it fits poorly here: no matching US plan and no US object storage.

Sizing assumptions (unverified until a real full game is processed): 4 GB RAM leaves room for
ffmpeg proxy encoding alongside the API; 2 GB is likely too tight. 100 GB holds a limited
number of full-game originals plus proxies. Measure real file sizes and grow the volume,
which can be resized upward without moving data. Vision labeling runs on the same host through
a local Ollama server (`OLLAMA_HOST`, `FOOTBALLOS_AI_MODEL`): there is no model API bill, but
the model needs RAM of its own (about 6 GB for `qwen3-vl:8b`, 3.5 GB for `qwen3-vl:4b`) on top
of the figures above, and CPU-only inference is slow; a GPU host or a separate Ollama machine on
a private network changes the sizing.

Provisioning, paying for, or transmitting team film to any host requires the owner's
explicit authorization first.

### Fallback: one Mac on the staff network

The same layout runs on a single Mac with no cloud cost. Install Node 22 and set
`FOOTBALLOS_DATA_DIR` to a folder on an internal or always-attached disk. Run the API as a
launchd agent instead of systemd, and back up the data folder nightly to a second disk (Time
Machine alone is not enough for a live SQLite file; use the online backup step below first).
The trade-offs: it is reachable only on the staff network unless a tunnel is added, and it
is offline whenever the Mac sleeps or is shut down.

## Service

Template unit: [`systemd/footballos-api.service`](systemd/footballos-api.service). It runs
as an unprivileged `footballos` user with a read-only filesystem except `FOOTBALLOS_DATA_DIR`,
restarts on failure, and reads secrets from `/etc/footballos/api.env`. The start command is
a placeholder until `apps/api` defines its production entry point.

Put TLS in front with a reverse proxy (Caddy obtains certificates automatically) and expose
only ports 80 and 443. Bind the API to `127.0.0.1`. Allow SSH by key only.

## Deploying a release (unverified)

1. CI must be green on the commit (`.github/workflows/ci.yml`).
2. On the host: check out the commit into `releases/<sha>`, run `npm ci`, then `npm run build`.
3. Take a pre-deploy database backup (see below) and tag it with the outgoing release sha.
4. Run migrations from the new release against `FOOTBALLOS_DATA_DIR`.
5. Point `current` at the new release and `systemctl restart footballos-api`.
6. Check `/healthz` and sign in once. Keep the previous three release directories.

## Rollback (unverified)

1. Point `current` back at the previous `releases/<sha>`.
2. If the failed release ran migrations, stop the service and restore the pre-deploy database
   copy from step 3 above. Migrations are forward-only; never run an old release against a
   newer schema.
3. Restart and check `/healthz`. Record what happened in the release log.

Media files are added, never rewritten in place, so a database rollback leaves orphaned
newer media files but does not lose older ones.

## Backups

Database backup and restore (tested; implementation in `tools/ops`, workspace `@footballos/ops`):

```bash
# Safe while the API is running. Exits 1 and keeps nothing if any step fails.
node scripts/backup-sqlite.mjs --db "$FOOTBALLOS_DATA_DIR/footballos.db" \
  --out "$FOOTBALLOS_DATA_DIR/backups" --keep 14

# Stop the API first. Verifies the checksum and integrity, and refuses to replace an existing
# database unless --force; the replaced file (and its -wal/-shm) is kept as *.pre-restore.
node scripts/restore-sqlite.mjs --from <backup.db> --db "$FOOTBALLOS_DATA_DIR/footballos.db" --force
```

What the backup does: SQLite's online backup API (consistent, including committed WAL
content), conversion of the copy to a single self-contained file (rollback-journal mode),
`PRAGMA integrity_check`, fsync, an atomic rename into place, and a `<file>.sha256` sidecar in
`sha256sum` format. `--keep N` then deletes all but the newest N backups.

Nightly schedule (unverified; needs the host):

1. Run the backup command above from a systemd timer.
2. Sync `media/` and the newest database copy with its `.sha256` to the Spaces bucket. Keep 14
   nightly and 8 weekly database copies there.
3. The script prints `backup ok ...` or `backup FAILED: ...` and exits non-zero on failure;
   monitoring alerts on a failure or on a missing success line.

The bucket is private, and its access keys can write to the backup bucket only.

## Restore drill

Do this at least once before release and after any storage change, on a separate machine or
an empty data directory, never over production:

1. Download the latest database copy and media from the bucket into an empty
   `FOOTBALLOS_DATA_DIR`.
2. Start the release that matches the backup's schema against it.
3. Verify: sign-in works, the latest game workspace opens, a known play's proxy plays at the
   right timestamp, and label corrections and plan approval history are present.
4. Record the date, backup age, time taken, and results in the table below.

| Date | Scope | Backup used | Restored by | Duration | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-25 | **Database tools only, local Mac, synthetic data.** Not an application restore: no `apps/api` schema, media or sign-in exists yet. | Online backup of a 200,000-row WAL-mode database (12.8 MB main file plus 12.9 MB un-checkpointed WAL), taken while a second process held it open | Agent (footballos-11, role F) with `scripts/backup-sqlite.mjs` then `scripts/restore-sqlite.mjs` into an empty directory | Backup 0.57 s, restore 0.56 s | Pass: row count (200,000), distinct segments (5,000) and latest timestamp match the source; `integrity_check` = ok on both; sha256 of the restored file matches the sidecar (`1a8ce49c…`) |
| — | Full application restore on the DigitalOcean host (steps 1–4 above) | — | — | — | **Not yet performed** |
