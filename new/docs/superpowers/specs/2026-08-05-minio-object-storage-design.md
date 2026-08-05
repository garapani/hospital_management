# MinIO/Object Storage Integration — Design Spec

**Source:** `pending-tasks.md` Phase 5 item 12 / `new-features.md` #12.

## Problem

`new-features.md` #12 asks for object storage integration: a client module, a
per-tenant object namespace policy, upload/download APIs, and a backup policy
for object data. The PRD (§9.1) already names MinIO as the object store,
namespaced by `hospitalId` so tenants share one object store without
cross-tenant visibility.

Today there is no object storage code anywhere in `apps/api`, and — unlike
Redis rate limiting (Phase 5 item 11), which had an immediate consumer in the
auth endpoints — **no domain module in this codebase currently produces or
consumes files.** DICOM (Phase 2), PDF reports, and Excel exports (Phase 6)
are all future work. Building generic upload/download REST endpoints now
would mean guessing their shape with no real caller to validate against.

## Scope

**In scope:**
- `@hospital/object-storage` Nx lib: MinIO client wrapper + tenant namespace
  policy.
- Local dev container (`docker-compose.dev.yml`).
- Backup policy documented in `Runbook.md`.

**Explicitly deferred (not in this item):**
- Generic upload/download REST endpoints — no real domain consumer exists
  yet to design them against. The first domain that actually needs to store
  a file (e.g. DICOM in Phase 2, reporting exports in Phase 6) wires its own
  controller against `ObjectStorageService`, the same way `PatientsService`
  wires against `TenantConnectionService` rather than the platform exposing
  a generic "run a query" endpoint.
- An actual backup script — nothing to back up until a real writer exists.
  Only the policy is documented now, so it doesn't have to be invented later
  under time pressure.

## Architecture

New Nx lib `@hospital/object-storage`, matching the existing shape of
`@hospital/tenant-context` / `@hospital/observability`: a NestJS module plus
one injectable service, nothing else.

- Wraps the official `minio` npm package (not `@aws-sdk/client-s3` — there is
  no stated plan to ever run against real AWS S3, and the official MinIO SDK
  has a simpler, purpose-built API: `putObject`/`getObject`/`presignedUrl`).
- **Single shared bucket**, not bucket-per-tenant, per PRD §9.1: "MinIO
  objects are namespaced by `hospitalId` so tenants share the object store
  without cross-tenant visibility." Bucket name from `OBJECT_STORAGE_BUCKET`
  (default `hospital-objects`).
- `ObjectStorageModule.forRoot()` builds the `minio.Client` from env vars and
  ensures the bucket exists on startup (idempotent `bucketExists` /
  `makeBucket`) — the same "no manual step" philosophy
  `TenantProvisioningService` follows for tenant schemas.

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `OBJECT_STORAGE_ENDPOINT` | `localhost` | MinIO host |
| `OBJECT_STORAGE_PORT` | `9002` | MinIO API port (dev container's mapped port) |
| `OBJECT_STORAGE_USE_SSL` | `false` | TLS toggle |
| `OBJECT_STORAGE_ACCESS_KEY` | `hospital_dev` | MinIO root/access key |
| `OBJECT_STORAGE_SECRET_KEY` | `hospital_dev_password` | MinIO root/secret key |
| `OBJECT_STORAGE_BUCKET` | `hospital-objects` | Shared bucket name |

## Namespace Policy — the core deliverable

`ObjectStorageService` never accepts a raw object key. Every method takes
`(tenantId: string, key: string, ...)` and internally builds the object key
as `${tenantId}/${key}` — structurally the same pattern
`TenantConnectionService.runInTenantSchema()` uses for Postgres: the caller
cannot bypass the tenant prefix by construction, not by convention or code
review discipline.

```ts
export class ObjectStorageService {
  putObject(tenantId: string, key: string, body: Buffer | Readable, size: number): Promise<void>;
  getObject(tenantId: string, key: string): Promise<Readable>;
  removeObject(tenantId: string, key: string): Promise<void>;
  presignedGetUrl(tenantId: string, key: string, expirySeconds: number): Promise<string>;
}
```

`tenantId` is validated against the same hospitalId identifier shape the
tenant registry already enforces (alphanumeric/hyphen, no `/`) before being
used in a key prefix — rejecting anything that isn't a clean identifier
closes off any attempt to craft a key that escapes its own tenant prefix.
(Object store keys are opaque strings, not filesystem paths — MinIO/S3 does
not collapse `..` segments — so this is defense-in-depth on the identifier
shape, not a path-traversal fix.)

## Dev Environment

Add `api-minio` to `docker-compose.dev.yml`, following the existing
non-default-port convention (Postgres host port 5433, Redis host port 6380):

- API: host port `9002` → container `9000`
- Console: host port `9003` → container `9001`
- Root credentials via `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` environment,
  matching `OBJECT_STORAGE_ACCESS_KEY` / `OBJECT_STORAGE_SECRET_KEY` defaults
  above.
- No volume — dev-only, matches Redis's no-persistence choice (nothing of
  value would survive a restart since there is no real writer yet).
- Healthcheck via MinIO's `/minio/health/live` endpoint.

## Backup Policy (documentation only)

New section in `Runbook.md` describing the policy for when a real writer
exists: MinIO bucket versioning enabled, plus a periodic `mc mirror` to the
same offsite S3-compatible target `scripts/backup-db.sh` already writes to,
same 30-day retention window as the Postgres backup policy (Phase 3 item 8).
Explicitly flagged as a documented policy with no implementing script yet —
tracked the same way item 8 flagged continuous WAL/PITR as a known,
explicit gap rather than silently absent.

## Testing

Per this session's standing fast-mode instruction: no automated tests are
written as part of this item. Manual verification only:

1. `docker-compose -f docker-compose.dev.yml up -d` (all three services) —
   confirm `api-minio` healthcheck passes.
2. From a scratch script (or `tsx` REPL), construct `ObjectStorageService`
   directly against the dev container and:
   - `putObject('tenant_demo', 'test.txt', Buffer.from('hello'), 5)`
   - `getObject('tenant_demo', 'test.txt')` — confirm the returned stream
     reads back `hello`.
   - Confirm via the MinIO console (`localhost:9003`) that the object
     actually lands at key `tenant_demo/test.txt` in the shared bucket —
     proving the namespace prefix is applied, not just accepted.
   - `removeObject('tenant_demo', 'test.txt')` — confirm cleanup.
3. `pnpm exec nx run-many -t typecheck test` — confirm the new lib
   typechecks and the existing suite is unaffected (this lib has no
   consumers yet, so no existing test should touch it).

## Documentation Updates

- `Development-Standards.md`: new `## 13. Object Storage` section covering
  the namespace-policy pattern, the single-bucket decision, and the
  deferred upload/download-API / backup-script scope.
- `Runbook.md`: new backup-policy section (above).
- `pending-tasks.md`: item 12 checked off, noting what shipped (client
  module + namespace policy + dev container + backup policy doc) and what's
  deferred (upload/download APIs and backup script — both wait for the
  first real domain consumer).
