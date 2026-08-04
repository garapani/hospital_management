# Backup/Restore Runbooks + Hardware Failure Recovery — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 3 item 8
(`new-features.md` #6 + #7)
**Scope:** operational documentation plus one backup script. No application code changes.

## Problem

`new-features.md` #6 and #7 ask for concrete backup/restore runbooks and a hardware-failure
recovery plan — neither exists today. `Runbook.md` has no backup/restore content at all, and
`Deployment-Guide.md` has no backup configuration section. `PRD.md` §9.3/§10 requires offsite
`pg_dump`/WAL backups and states a hardware fault on a self-owned server is a real outage with no
cloud-provider safety net, but never specifies the actual mechanics — exactly the gap `PRD.md` §12
open question #3 calls out.

That question has a real upstream dependency: `PRD.md` §12 open question #1 (self-owned in-house
server vs. Hostinger VPS) is still unresolved, and it changes what "hardware failure recovery"
even means — a VPS provider absorbs the hardware failure itself (recovery = new instance from a
snapshot), while a self-owned server needs an actual spare-hardware/rebuild runbook. Per the human
partner's direction, this item targets the **Hostinger VPS path**, since `PRD.md` §12 itself
already states a VPS is "under active consideration/use in the interim" — writing this runbook
against what's actually deployed today rather than the still-undecided long-term self-owned target.

## Decisions

- **Backup mechanism: nightly `pg_dump`, not continuous WAL/PITR.** A single `pg_dump -Fc` (custom
  format) of the whole `identity_access` database captures every tenant schema plus the shared
  `public` schema in one dump, since all tenants live in one Postgres database as separate schemas
  — there is no need to dump per-tenant. Continuous WAL archiving (point-in-time recovery) needs
  meaningfully more ops setup (`archive_command`, a tool like pgBackRest/WAL-G, a WAL retention
  policy) than this pass covers — explicitly deferred (see Non-goals), with the resulting RPO
  stated plainly rather than hidden: **up to 24 hours of data loss**, bounded by the nightly cadence.
- **Offsite target: S3-compatible object storage, India region** (e.g. AWS S3 `ap-south-1`/Mumbai,
  or a comparable India-region S3-compatible provider). Satisfies `PRD.md` §10's data-residency
  requirement, uses standard tooling (`aws-cli`), and the backup script targets the generic
  S3-compatible API so the exact provider is swappable without a script rewrite.
- **New script: `new/code/scripts/backup-db.sh`.** Runs `docker exec` against the compose
  Postgres service to `pg_dump -Fc`, gzips the result, uploads to the configured S3 bucket, and
  prunes both the local working copy and remote objects older than a 30-day retention window.
  Explicitly targets `docker-compose.dev.yml`'s `api-postgres` service name today — the script's
  target service name is itself a placeholder pending the still-open production
  `docker-compose.yml` gap (`pending-tasks.md`'s dependencies section, from Phase 2 item 5). A
  nightly cron entry invokes it; `Deployment-Guide.md` documents the crontab line.
- **Full-database restore + per-tenant restore, both via `pg_restore`.** Full restore replays the
  whole dump into a fresh/target database. Per-tenant restore uses
  `pg_restore --schema=tenant_<id> --dbname=... backup.dump` — `pg_restore`'s `--schema` filter
  means this never touches any other tenant's schema or the platform's `public` schema, so a
  single hospital's data can be restored in isolation, matching `PRD.md` §10's backup/restore NFR.
- **Monthly restore-drill procedure, documented not automated.** Restore the latest dump into a
  scratch database, run one smoke query per major table group (confirm row counts are non-zero and
  a known-shape query returns expected columns), log the result (date, dump age, pass/fail) in the
  runbook itself as a running drill log. Automating this is future work, not built here — see
  Non-goals.
- **Hardware failure recovery, VPS path.** Target RTO: **~4 hours**. Step-by-step: provision a new
  Hostinger VPS (or restore from a Hostinger-level snapshot if one exists and is recent enough),
  install Docker/Compose, pull the repo, bring up the compose stack, pull the latest offsite dump
  from S3, `pg_restore` it, run the smoke checks from the restore-drill procedure, then cut DNS's A
  record over to the new VPS's IP (TTL and exact DNS provider are host-specific, noted as a
  configuration detail to fill in against whatever DNS provider is actually in use). Owner and
  escalation path is left as an explicit placeholder — a real name/contact/on-call rotation is an
  organizational decision the human partner fills in, not something to fabricate.

## Non-goals

- **Continuous WAL archiving / point-in-time recovery.** Nightly `pg_dump` only. PITR is real
  future work once the system is past prototype stage and the 24h RPO stops being acceptable —
  tracked as a follow-up note in the runbook itself, not solved here.
- **Automating the monthly restore drill.** Documented manual procedure only; a scheduled job that
  runs it and pages on failure is a natural evolution but adds real infra (another cron job with
  failure alerting, which itself depends on the observability stack already deferred out of Phase 3
  item 6) — out of scope.
- **The self-owned-server hardware-recovery runbook.** Explicitly not written in this pass per the
  human partner's direction — `PRD.md` §12 open question #1 is unresolved, and writing a
  spare-hardware/rebuild procedure for infrastructure that may never be deployed would be wasted,
  possibly-wrong work. If the self-owned direction is later finalized, this becomes a follow-up
  item, not a revision of this one.
- **Naming a specific escalation owner/on-call contact.** Organizational information the human
  partner supplies, not something inferred or invented.
- **Provisioning the actual S3 bucket, Hostinger VPS, or DNS records.** This is documentation plus
  a script; no cloud resources are created as part of this task. The script assumes bucket/
  credentials already exist and are supplied via env vars (documented in Deployment-Guide.md's new
  section), matching this repo's existing `.env`-based secrets convention.

## Testing

- `new/code/scripts/backup-db.sh` is a shell script, not application code — no Jest suite applies.
  Verification is running it manually against the local dev stack
  (`docker-compose.dev.yml`'s `api-postgres` service) with a scratch/throwaway S3 bucket (or a
  local filesystem path substituted for the S3 upload step, documented as a dry-run mode) and
  confirming: the dump file is produced, it's a valid `pg_dump -Fc` file (`pg_restore --list`
  against it succeeds), and old local files older than the retention window get pruned.
- No existing suite (`nx run-many -t typecheck test`) is affected — this task touches no
  `apps/api`/`libs/*` source.
