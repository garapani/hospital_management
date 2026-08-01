# Testing Patterns

**Analysis Date:** 2026-08-01

## Test Framework

**Runner:**
- Jest ~30.3.0, orchestrated through Nx (`@nx/jest` 23.1.0)
- Root config: `new/code/jest.config.ts` — delegates to `getJestProjectsAsync()`, aggregating each project's own config
- Root preset: `new/code/jest.preset.js` — thin wrapper over `@nx/jest/preset`
- Per-project config: `new/code/apps/api/jest.config.cts`, `new/code/libs/<lib>/jest.config.cts` — each declares `displayName`, uses `@swc/jest` for transform (via `.spec.swcrc`), `testEnvironment: 'node'`

**Assertion Library:**
- Jest's built-in `expect` — no Chai/Sinon

**Run Commands:**
```bash
pnpm exec nx run-many -t typecheck test   # per project convention, run BOTH — typecheck catches missing .js import extensions that Jest's SWC transform ignores
pnpm exec nx test api                     # run only the api project
pnpm exec nx test api --testFile=patients.service.integration-spec.ts
```

Nx is the required entry point — `new/code/CLAUDE.md` mandates using `nx run`/`nx run-many`/`nx affected` over calling `jest` directly. CI (`new/code/.github/workflows/ci.yml`) runs only `test` and `typecheck`; `lint`/`build`/`e2e` are intentionally absent (no ESLint config or build targets exist yet).

## Test File Organization

**Location:**
- Co-located with source, not in a separate `__tests__` or `test/` directory — `apps/api/src/patients/patients.service.ts` sits next to `apps/api/src/patients/patients.service.integration-spec.ts`

**Naming:**
- `<subject>.integration-spec.ts` is the dominant convention across the codebase — nearly every service and controller has one
- Plain `.spec.ts` also appears for narrower checks not tied to a specific service, e.g. `apps/api/src/esm-package-type.spec.ts`, `apps/api/src/tenant-context-interop.spec.ts`
- No `.unit-spec.ts` or dedicated unit-test naming convention exists — see "Test Types" below

**testMatch (from `apps/api/jest.config.cts`):**
```javascript
testMatch: [
  '**/?(*.)+(spec|test).[jt]s?(x)',
  '**/?(*.)+(integration-spec).[jt]s?(x)',
],
```

**Structure:**
```
apps/api/src/<module>/
├── <module>.controller.ts
├── <module>.controller.integration-spec.ts
├── <module>.service.ts
├── <module>.service.integration-spec.ts
├── <module>.module.ts
├── dto/
└── entities/
```

## Test Structure

**Suite Organization** (from `apps/api/src/patients/patients.service.integration-spec.ts`):
```typescript
describe('PatientsService (integration)', () => {
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let service: PatientsService;
  const schema = 'tenant_patients_service_test';

  beforeAll(async () => {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    // manually construct services (no DI container) when testing a single service in isolation
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    service = new PatientsService(tenantConnection, generatorService);

    // per-suite Postgres schema, dropped and recreated for isolation
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dataSource.query(`CREATE SCHEMA "${schema}"`);
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schema}"`);
    await new CreatePatientTables005().up(queryRunner);
    await queryRunner.release();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  it('registers patient and triggers conflict exception on duplicate phone without override', async () => {
    await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c1' }, async () => {
      // ... arrange/act/assert inside the tenant-scoped async context
    });
  });
});
```

**Two setup styles observed, by test scope:**
1. **Single-service tests** manually `new` up the service and its direct dependencies against a dedicated schema (`patients.service.integration-spec.ts`) — faster, narrower blast radius.
2. **Cross-module/full-stack tests** boot the entire `AppModule` via Nest's `Test.createTestingModule({ imports: [AppModule] }).compile()` and pull services out of the DI container with `moduleFixture.get(Service)` (`apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts`) — used when the test needs to exercise the wiring between multiple real modules (e.g., verifying reporting events fire from patient, admission, order, invoice, and deposit flows together).

**Patterns:**
- Setup: real Postgres schema created/dropped per suite via raw `dataSource.query(...)` DDL, not an ORM migration runner shortcut — migrations are applied by directly invoking `up(queryRunner)` on the migration class
- Teardown: `afterAll` drops the schema (`DROP SCHEMA IF EXISTS ... CASCADE`); full-app suites also `await app.close()`
- Assertion: `expect(x).rejects.toThrow(SomeHttpException)` for error-path assertions on service methods; `toMatchObject` for partial-shape assertions on returned/persisted records

## Mocking

**Framework:** None used. A repo-wide search for `jest.fn`, `jest.mock`, and `createMock` across `apps/api/src` and `libs` returns zero matches.

**What to Mock:**
- Nothing — this codebase does not use test doubles for collaborators.

**What NOT to Mock (by convention here):**
- Database access, tenant resolution, and cross-service calls are all exercised against a real Postgres instance and real service instances. There is no unit-test layer with mocked repositories/services — every `*.integration-spec.ts` file talks to an actual (test-schema-scoped) database.
- When adding tests for new code, follow this pattern: construct real service instances (or boot `AppModule`) against a per-test Postgres schema, rather than introducing mocking libraries not already present in the dependency tree.

## Fixtures and Factories

**Test Data:**
- No shared fixture/factory files or builder pattern — each test inlines its own DTO literals directly in the `it(...)` block:
```typescript
const p1 = await service.create({
  firstName: 'Alice',
  lastName: 'Smith',
  gender: 'Female',
  phoneNumber: '9998887770',
});
```
- Tenant IDs for isolation are inlined per suite, sometimes with a `Date.now()` suffix to guarantee uniqueness across parallel test runs: `` `test_reporting_${Date.now()}` `` (`apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts:33`)

**Location:**
- None — no `fixtures/`, `factories/`, or `test-utils/` directory exists under `apps/api/src`

## Coverage

**Requirements:** No coverage threshold enforced in `jest.config.cts` or CI — `coverageDirectory: 'test-output/jest/coverage'` is configured but no `coverageThreshold` block exists.

**View Coverage:**
```bash
pnpm exec nx test api --coverage
```

## Test Types

**Unit Tests:** None in the strict sense (no mocked collaborators). The closest analogue is the "single-service" integration style described above, which isolates one service but still hits a real database.

**Integration Tests:** The dominant and effectively only test type — `*.integration-spec.ts` files test service/controller behavior against a real Postgres schema, either standalone or via a fully-booted `AppModule`. Files like `apps/api/src/accounts/audit-wiring.integration-spec.ts`, `apps/api/src/tenants/tenants-permission-gating.integration-spec.ts`, and `apps/api/src/master-data/master-data-permission-gating.integration-spec.ts` specifically test cross-cutting concerns (audit logging, permission gating) at the integration level rather than as isolated unit tests.

**E2E Tests:** Not used — no e2e target/config exists (confirmed by `new/code/CLAUDE.md`: "lint/build/e2e are intentionally omitted... no ESLint config or build targets exist yet").

## Common Patterns

**Async Testing:**
```typescript
// Tenant-scoped async work always wrapped in tenantContext.run(...)
await tenantContext.run({ tenantId: 'patients_service_test', correlationId: 'c1' }, async () => {
  const p1 = await service.create({ ... });
  expect(p1.patientNo).toBeDefined();
});
```

**Error Testing:**
```typescript
await expect(
  service.create({
    firstName: 'Alice',
    lastName: 'Smith',
    gender: 'Female',
    phoneNumber: '9998887770',
    allowDuplicate: false,
  }),
).rejects.toThrow(ConflictException);
```

**Multi-tenant isolation testing:**
```typescript
// apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts
it('enforces tenant isolation', async () => {
  await inTenant(TEST_TENANT_ID_2, async () => {
    const events = await tenantConnection.runInTenantSchema((m) => m.getRepository(ReportingEvent).count());
    expect(events).toBe(0); // Should be 0 because all previous events were in TEST_TENANT_ID_1
  });
});
```
Every module that supports multiple tenants should include an explicit isolation test proving data written under one tenant is invisible under another.

---

*Testing analysis: 2026-08-01*
