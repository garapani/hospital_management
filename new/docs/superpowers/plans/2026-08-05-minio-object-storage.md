# MinIO/Object Storage Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `@hospital/object-storage` library wrapping MinIO with a structurally-enforced per-tenant key namespace, a local dev MinIO container, and a documented (not yet scripted) backup policy — no upload/download REST endpoints, since no domain module produces or consumes files yet.

**Architecture:** A new Nx platform-lib (`type:platform-lib`, same tag as `@hospital/tenant-context`/`@hospital/observability`) exposes one NestJS module (`ObjectStorageModule`) and one injectable service (`ObjectStorageService`). The module builds a `minio.Client` from env vars and ensures the shared bucket exists on startup. The service's every method takes `(tenantId, key, ...)` and internally builds the real object key as `${tenantId}/${key}` — the caller has no way to pass a raw, unprefixed key.

**Tech Stack:** `minio` npm package (`^8.0.7`, already installed and confirmed against its `.d.ts`), NestJS, Nx.

## Global Constraints

- Single shared bucket, not bucket-per-tenant (PRD §9.1) — bucket name from `OBJECT_STORAGE_BUCKET`, default `hospital-objects`.
- Env vars: `OBJECT_STORAGE_ENDPOINT` (default `localhost`), `OBJECT_STORAGE_PORT` (default `9002`), `OBJECT_STORAGE_USE_SSL` (default `false`), `OBJECT_STORAGE_ACCESS_KEY` (default `hospital_dev`), `OBJECT_STORAGE_SECRET_KEY` (default `hospital_dev_password`), `OBJECT_STORAGE_BUCKET` (default `hospital-objects`).
- `minio`'s real API (confirmed from `node_modules/minio/dist/main/internal/client.d.ts` after installing): `new Client({ endPoint, port, useSSL, accessKey, secretKey })`; `bucketExists(bucketName): Promise<boolean>`; `makeBucket(bucketName, region?, makeOpts?): Promise<void>`; `putObject(bucketName, objectName, stream, size?, metaData?): Promise<UploadedObjectInfo>`; `getObject(bucketName, objectName, getOpts?): Promise<stream.Readable>`; `removeObject(bucketName, objectName, removeOpts?): Promise<void>`; `presignedGetObject(bucketName, objectName, expires?, ...): Promise<string>`. Named import `import { Client } from 'minio'` — this package ships proper ESM (`"default": "./dist/esm/minio.mjs"` in its `exports` map), unlike `ioredis`, so no default-import gotcha here.
- `tenantId` validated against `^[a-z0-9_-]+$` before being used in a key prefix (matches the shape hospitalId/tenant identifiers already take elsewhere in this codebase) — rejects anything that isn't a clean identifier.
- No upload/download REST endpoints in this item — deferred to the first real domain consumer.
- No backup script in this item — `Runbook.md` gets a documented policy only.
- Every relative import needs an explicit `.js` extension (this repo's `tsconfig.base.json` uses `nodenext` module resolution) — e.g. `from './object-storage.service.js'`.
- Never `git commit --amend`; new commit per task; no AI co-authorship trailer; conventional commit prefixes.
- No automated tests this session (standing fast-mode instruction) — manual verification only, per each task's steps below.

---

### Task 1: `@hospital/object-storage` library scaffold + `ObjectStorageService`

**Files:**
- Create: `new/code/libs/object-storage/package.json`
- Create: `new/code/libs/object-storage/tsconfig.json`
- Create: `new/code/libs/object-storage/tsconfig.lib.json`
- Create: `new/code/libs/object-storage/tsconfig.spec.json`
- Create: `new/code/libs/object-storage/jest.config.cts`
- Create: `new/code/libs/object-storage/.spec.swcrc`
- Create: `new/code/libs/object-storage/src/index.ts`
- Create: `new/code/libs/object-storage/src/lib/object-storage.service.ts`
- Create: `new/code/libs/object-storage/src/lib/object-storage.module.ts`

**Interfaces:**
- Produces: `ObjectStorageService` with `putObject(tenantId: string, key: string, body: Buffer | Readable | string, size: number, metaData?: ItemBucketMetadata): Promise<void>`, `getObject(tenantId: string, key: string): Promise<Readable>`, `removeObject(tenantId: string, key: string): Promise<void>`, `presignedGetUrl(tenantId: string, key: string, expirySeconds: number): Promise<string>`.
- Produces: `ObjectStorageModule` (importable, no `.forRoot()` — reads env vars directly at construction time, matching `TenantContextModule`'s `@Global()` + no-config-object shape).
- Produces: `OBJECT_STORAGE_BUCKET_TOKEN`-free design — the bucket name is read from env inside the service itself (no DI token needed since there's exactly one consumer of config: the service).

- [ ] **Step 1: Scaffold the library's config files**

Create `new/code/libs/object-storage/package.json`:

```json
{
  "name": "@hospital/object-storage",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "nx": {
    "tags": ["type:platform-lib"]
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./package.json": "./package.json"
  }
}
```

`minio` itself is a third-party npm package, not a workspace-internal `@hospital/*` lib — following
this repo's established convention (see `tenant-context`'s `package.json`, which lists only its
`@hospital/auth-guards` workspace dependency, never `@nestjs/common` even though it uses it),
third-party packages are added at the **root** `new/code/package.json`, not inside an individual
lib's `package.json`. Run this from `new/code`:

```bash
pnpm add -w minio
```

Expected: `new/code/package.json` gains a `"minio": "^8.0.7"` entry under `dependencies`, and
`new/code/pnpm-lock.yaml` updates accordingly.

Create `new/code/libs/object-storage/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    },
    {
      "path": "./tsconfig.spec.json"
    }
  ]
}
```

Create `new/code/libs/object-storage/tsconfig.lib.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo",
    "emitDeclarationOnly": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": [
    "jest.config.ts",
    "jest.config.cts",
    "src/**/*.spec.ts",
    "src/**/*.test.ts"
  ]
}
```

Create `new/code/libs/object-storage/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./out-tsc/jest",
    "types": ["jest", "node"],
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "jest.config.ts",
    "jest.config.cts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    }
  ]
}
```

Create `new/code/libs/object-storage/.spec.swcrc`:

```json
{
  "jsc": {
    "target": "es2017",
    "parser": {
      "syntax": "typescript",
      "decorators": true,
      "dynamicImport": true
    },
    "transform": {
      "decoratorMetadata": true,
      "legacyDecorator": true
    },
    "keepClassNames": true,
    "externalHelpers": true,
    "loose": true
  },
  "module": {
    "type": "es6"
  },
  "sourceMaps": true,
  "exclude": []
}
```

Create `new/code/libs/object-storage/jest.config.cts`:

```ts
/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@hospital/object-storage',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
```

- [ ] **Step 2: Write `ObjectStorageService`**

Create `new/code/libs/object-storage/src/lib/object-storage.service.ts`:

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, type ItemBucketMetadata } from 'minio';
import type { Readable } from 'node:stream';

const TENANT_ID_PATTERN = /^[a-z0-9_-]+$/;

function assertValidTenantId(tenantId: string): void {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error(`Invalid tenantId for object storage key prefix: ${tenantId}`);
  }
}

function namespacedKey(tenantId: string, key: string): string {
  assertValidTenantId(tenantId);
  return `${tenantId}/${key}`;
}

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env['OBJECT_STORAGE_BUCKET'] ?? 'hospital-objects';
    this.client = new Client({
      endPoint: process.env['OBJECT_STORAGE_ENDPOINT'] ?? 'localhost',
      port: Number(process.env['OBJECT_STORAGE_PORT'] ?? 9002),
      useSSL: process.env['OBJECT_STORAGE_USE_SSL'] === 'true',
      accessKey: process.env['OBJECT_STORAGE_ACCESS_KEY'] ?? 'hospital_dev',
      secretKey: process.env['OBJECT_STORAGE_SECRET_KEY'] ?? 'hospital_dev_password',
    });
  }

  async onModuleInit(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created object storage bucket "${this.bucket}"`);
    }
  }

  async putObject(
    tenantId: string,
    key: string,
    body: Buffer | Readable | string,
    size: number,
    metaData?: ItemBucketMetadata,
  ): Promise<void> {
    await this.client.putObject(this.bucket, namespacedKey(tenantId, key), body, size, metaData);
  }

  async getObject(tenantId: string, key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, namespacedKey(tenantId, key));
  }

  async removeObject(tenantId: string, key: string): Promise<void> {
    await this.client.removeObject(this.bucket, namespacedKey(tenantId, key));
  }

  async presignedGetUrl(tenantId: string, key: string, expirySeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, namespacedKey(tenantId, key), expirySeconds);
  }
}
```

- [ ] **Step 3: Write `ObjectStorageModule`**

Create `new/code/libs/object-storage/src/lib/object-storage.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service.js';

@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
```

- [ ] **Step 4: Write the barrel export**

Create `new/code/libs/object-storage/src/index.ts`:

```ts
export * from './lib/object-storage.service.js';
export * from './lib/object-storage.module.js';
```

- [ ] **Step 5: Typecheck the new library in isolation**

Run: `pnpm exec nx run object-storage:typecheck` (from `new/code`)
Expected: PASS, no errors. If Nx doesn't recognize the project yet, run `pnpm exec nx show projects` first to confirm `object-storage` was picked up from the new `package.json` (Nx's project-crawling is automatic here — no `project.json` needed, matching the other libs in this workspace).

- [ ] **Step 6: Commit**

```bash
git add new/code/libs/object-storage new/code/package.json new/code/pnpm-lock.yaml
git commit -m "feat(object-storage): add ObjectStorageService with tenant-namespaced MinIO client"
```

---

### Task 2: Local dev MinIO container + manual verification against the real service

**Files:**
- Modify: `new/code/docker-compose.dev.yml`

**Interfaces:**
- Consumes: `ObjectStorageService` from Task 1 (`putObject`/`getObject`/`removeObject`).
- Produces: nothing new for later tasks — this task proves Task 1's service actually works against a real MinIO instance before it gets documented as done.

- [ ] **Step 1: Add the `api-minio` service**

Current full content of `new/code/docker-compose.dev.yml`:

```yaml
services:
  api-postgres:
    image: postgres:16-alpine
    container_name: api-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - api-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

  api-redis:
    image: redis:7-alpine
    container_name: api-redis-dev
    ports:
      - '6380:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  api-postgres-data:
```

Replace with (adds `api-minio`, keeping the two existing services untouched):

```yaml
services:
  api-postgres:
    image: postgres:16-alpine
    container_name: api-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - api-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

  api-redis:
    image: redis:7-alpine
    container_name: api-redis-dev
    ports:
      - '6380:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

  api-minio:
    image: minio/minio:latest
    container_name: api-minio-dev
    environment:
      MINIO_ROOT_USER: hospital_dev
      MINIO_ROOT_PASSWORD: hospital_dev_password
    command: server /data --console-address ":9001"
    ports:
      - '9002:9000'
      - '9003:9001'
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  api-postgres-data:
```

- [ ] **Step 2: Bring up the stack and confirm the container is healthy**

Run: `docker-compose -f new/code/docker-compose.dev.yml up -d`
Then: `docker ps --filter name=api-minio-dev --format '{{.Names}}: {{.Status}}'`
Expected: status shows `(healthy)` within ~15s.

- [ ] **Step 3: Manually verify `ObjectStorageService` against the real container**

Write a scratch script (do not commit it) at `new/code/apps/api/scratch-verify-object-storage.ts`:

```ts
import { ObjectStorageService } from '@hospital/object-storage';

async function main() {
  process.env['OBJECT_STORAGE_ENDPOINT'] = 'localhost';
  process.env['OBJECT_STORAGE_PORT'] = '9002';
  process.env['OBJECT_STORAGE_ACCESS_KEY'] = 'hospital_dev';
  process.env['OBJECT_STORAGE_SECRET_KEY'] = 'hospital_dev_password';
  process.env['OBJECT_STORAGE_BUCKET'] = 'hospital-objects';

  const service = new ObjectStorageService();
  await service.onModuleInit();

  await service.putObject('tenant_demo', 'test.txt', Buffer.from('hello'), 5);
  console.log('put OK');

  const stream = await service.getObject('tenant_demo', 'test.txt');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const content = Buffer.concat(chunks).toString('utf-8');
  console.log('get OK, content =', content);
  if (content !== 'hello') {
    throw new Error(`Expected "hello", got "${content}"`);
  }

  await service.removeObject('tenant_demo', 'test.txt');
  console.log('remove OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run from `new/code/apps/api`: `pnpm exec tsx scratch-verify-object-storage.ts`
Expected output: `put OK`, `get OK, content = hello`, `remove OK`.

Then open `http://localhost:9003` (MinIO console, login `hospital_dev`/`hospital_dev_password`) **before** running the remove step, to visually confirm the object actually lands at key `tenant_demo/test.txt` inside the `hospital-objects` bucket — this is the one check that proves the namespace prefix is really being applied, not just accepted by the type signature. (Comment out the `removeObject` call temporarily if you want to inspect it after the fact instead of racing the console load.)

Delete the scratch script once verified: `rm new/code/apps/api/scratch-verify-object-storage.ts`

- [ ] **Step 4: Confirm the rest of the suite is unaffected**

Run: `pnpm exec nx run-many -t typecheck test` (from `new/code`)
Expected: same pass count as the pre-existing baseline (this library has no consumers yet, so nothing else should be touched).

- [ ] **Step 5: Commit**

```bash
git add new/code/docker-compose.dev.yml
git commit -m "feat(ops): add MinIO service to local dev compose stack"
```

---

### Task 3: Documentation — Development-Standards, Runbook, pending-tasks

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/Runbook.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (terminal task for this plan).

- [ ] **Step 1: Add `## 13. Object Storage` to `Development-Standards.md`**

The file currently ends (last lines) with:

```
See `new/docs/superpowers/plans/2026-08-05-redis-rate-limiting.md` for the full implementation
history.
```

Append after that:

```markdown

## 13. Object Storage

`@hospital/object-storage` wraps the official `minio` npm package behind one injectable service,
`ObjectStorageService`. Every method takes `(tenantId, key, ...)`, never a raw object key — the
service builds the real key internally as `${tenantId}/${key}`, the same structural-enforcement
pattern `TenantConnectionService.runInTenantSchema()` uses for Postgres (`SET LOCAL ROLE` inside a
real transaction): the caller cannot bypass the tenant prefix by construction, not by convention.

**Single shared bucket** (`OBJECT_STORAGE_BUCKET`, default `hospital-objects`), not
bucket-per-tenant — matches `PRD.md` §9.1's stated design ("MinIO objects are namespaced by
`hospitalId` so tenants share the object store without cross-tenant visibility"). `tenantId` is
validated against `^[a-z0-9_-]+$` before being used in a key prefix; object store keys are opaque
strings, not filesystem paths, so MinIO/S3 never collapses `..` segments the way a real filesystem
would — this validation is defense-in-depth on identifier shape, not a path-traversal fix.

**Scope of this item:** client module + namespace policy + local dev container + a documented
(not yet scripted) backup policy. **Deferred:** generic upload/download REST endpoints — no domain
module in this codebase produces or consumes files yet (DICOM, PDF reports, and Excel exports are
all future Phase 2/6 work), so building a generic "upload anything" endpoint now would mean
guessing its shape with no real caller to validate against. The first domain that actually needs
to store a file wires its own controller directly against `ObjectStorageService`, the same way
`PatientsService` wires against `TenantConnectionService` rather than the platform exposing a
generic "run a query" endpoint. A backup script is deferred the same way — nothing to back up
until a real writer exists (see `Runbook.md`'s Object Storage Backup Policy section).

See `new/docs/superpowers/plans/2026-08-05-minio-object-storage.md` for the full implementation
history.
```

- [ ] **Step 2: Add the backup-policy section to `Runbook.md`**

The file currently ends (last lines) with:

```
### Owner and escalation

_(Placeholder — fill in the actual on-call owner/escalation contact for this procedure. Not
something this runbook can supply on its own.)_
```

Append after that:

```markdown

## 7. Object Storage Backup Policy

**Status: documented policy only — no implementing script yet.** There is currently no domain
module writing real objects to MinIO (see `Development-Standards.md` §13), so there is nothing to
back up today. This section exists so the policy doesn't have to be invented later under time
pressure once a real writer (e.g. DICOM in Phase 2, reporting exports in Phase 6) lands.

**Policy, once a real writer exists:**

1. Enable bucket versioning on the shared `hospital-objects` bucket (`mc version enable`), so an
   overwritten or deleted object stays recoverable.
2. Run a periodic `mc mirror` job from the `hospital-objects` bucket to the same offsite
   S3-compatible target `scripts/backup-db.sh` already uploads Postgres dumps to (`S3_BUCKET`/
   `S3_PREFIX` env vars, see `Deployment-Guide.md` "Backup Configuration") — a separate
   `S3_PREFIX` (e.g. `object-storage-backups`) keeps it from colliding with the Postgres dump
   prefix in the same bucket.
3. Apply the same 30-day retention lifecycle rule used for Postgres backups (`Deployment-Guide.md`
   §"Configure a bucket lifecycle rule expiring objects... after 30 days").

**Not yet decided:** cron schedule and frequency for the mirror job — likely nightly, alongside
`backup-db.sh`, but not fixed until real object volume exists to size it against.
```

- [ ] **Step 3: Check off item 12 in `pending-tasks.md`**

Current line 95:

```
12. **MinIO/object storage integration** (new-features.md #12) — independent, no urgency driver.
```

Replace with:

```
12. [x] **MinIO/object storage integration** (new-features.md #12) — done: `@hospital/object-storage`
    library (MinIO client + tenant-namespaced key policy, single shared bucket per PRD.md §9.1),
    local dev MinIO container. **Not done:** upload/download REST endpoints (deferred — no domain
    module produces or consumes files yet; the first real consumer wires directly against
    `ObjectStorageService`) and an actual backup script (deferred — nothing to back up yet;
    `Runbook.md` §7 documents the policy for when one exists).
```

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/Runbook.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document object storage module, check off Phase 5 item 12"
```
