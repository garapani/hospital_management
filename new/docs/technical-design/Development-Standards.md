# Development Standards

This document establishes the coding conventions, architecture rules, and testing standards for the Hospital Management System.

## 1. Modular Monolith Strictness
We have embraced a **Modular Monolith** architecture using Nx and NestJS. 
While all modules exist in a single repository and run in a single process, they must remain logically isolated.
- **Bounded Contexts**: Never perform database joins across bounded contexts (e.g., joining an `Order` table to a `Patient` table). Treat each module as if it were a distinct microservice.
- **Inter-Module Communication**: If a module requires data from another module, it must inject the corresponding Service (e.g., `PatientsService` inside `EncountersService`) rather than accessing the Repository directly.
- **Nx Linting**: We utilize `@nx/enforce-module-boundaries` to enforce dependency graphs. Do not bypass these lint rules.

## 2. Multi-Tenancy (Data Isolation)
- **Schema-per-Tenant**: Every tenant operates in their own Postgres schema (`tenant_<hospitalId>`).
- **Never hardcode schemas**: Do not pass `schema` configurations statically in Entities. The `TenantConnectionService` dynamically applies `SET search_path TO "tenant_XYZ"` to the active Postgres connection.
- **Audit Compliance**: You must never execute queries outside of the `TenantConnectionService.runInTenantSchema()` boundary unless querying globally shared master data. 

## 3. Asynchronous Events & Lifecycle Hooks
To keep the primary business operations fast and resilient, cross-cutting concerns (Audit Logs, Analytics, Search Indexing) must be decoupled from the core transaction.
- **TypeORM Subscribers**: Use `EntitySubscriberInterface` (e.g., `ReportingSubscriber`).
- **Fire-and-Forget**: Publishers must wrap external/secondary database writes in a `try/catch` block. A failure to write an audit log should **never** roll back a life-saving clinical order.
- **Lifecycle Caveats**: Remember that TypeORM `afterInsert` fires before child entities are saved if the parent service performs sequential `.save()` calls instead of using `cascade: true`. Plan your payload extraction accordingly.

## 4. TypeScript & ESM Rules
- **ES Modules**: The project strictly enforces ESM (`"type": "module"` in `package.json`).
- **File Extensions**: All relative imports in `.ts` files MUST include the `.js` extension. Example: `import { Patient } from './patient.entity.js';`
- **Strict Typing**: Ensure `strict: true` is enabled. Avoid `any` types.

## 5. Testing
We enforce a high standard of integration testing against real databases rather than mocking out Repositories.

### Tenant-scoped integration tests

Every integration spec provisions a real tenant schema and runs against it — there is no
transaction-rollback isolation anywhere in this codebase. Use the shared helper in
`apps/api/src/testing/tenant-test-context.ts`:

```ts
let ctx: TenantTestContext;

beforeAll(async () => {
  ctx = await setupTenantTestContext({ namePrefix: 'my-feature', seedRbac: true });
});

afterAll(() => teardownTenantTestContext(ctx));

it('...', async () => {
  await ctx.inTenant(() => ctx.someService.doSomething());
});
```

Tenant IDs are sequential and deterministic (`my-feature_1`, `my-feature_2`, ...) — never a
timestamp or random suffix. `setupTenantTestContext()` drops any same-named schema before
provisioning, so a schema left behind by a crashed prior run never collides with the next one.

For tests needing more than one tenant (e.g. isolation tests), call `await ctx.createTenant()` —
it shares the same connection and returns the next sequential tenant ID.

**Audit and reporting subscribers in tests:** both fire on any tracked entity insert regardless
of a test's isolation model, and write into the *same* tenant schema under test — audit via the
main connection pool, reporting via its own dedicated pool (see
`new/docs/superpowers/plans/2026-08-01-reporting-archiver.md`). Both get cleaned up by the same
`teardownTenantTestContext()` call, since they're schema-scoped, not transaction-scoped.

- **Zero-Pollution**: Tests must not leave residual data. Always use the built-in Jest hooks to clean up connections (`app.close()`).
