# Global ValidationPipe — Design

**Status:** Approved (Phase A only — Phase B is a separate, deferred backlog item)
**Repos:** `new_hospital` (backend, `new/code`) only.

## Problem Statement

No `ValidationPipe` — global or per-route — is registered anywhere in `apps/api`
(`main.ts`/`app.module.ts` grepped clean for `ValidationPipe`/`APP_PIPE`). NestJS only runs
`class-validator`/`class-transformer` decorators through an active `ValidationPipe`; without one,
every `@Body()`/`@Query()` DTO is a plain object with zero runtime validation or type coercion, no
matter what decorators its class declares.

Task 2.13 (payroll payslips 500) was one concrete symptom: an unvalidated `month`/`year` query
param reached a query builder as the literal string `"undefined"`. That was fixed at the frontend
(stop sending the key), but the underlying gap — decorators that compile and typecheck but do
nothing at request time — is general and still open.

**Re-audited scope while designing this** (grep for `*.dto.ts` under `apps/api/src`):

- 104 total DTO files.
- Only **9** have any `class-validator` decorator at all:
  `pharmacy/dto/list-pharmacy-dispensing.dto.ts`, `lab/dto/update-price.dto.ts`,
  `radiology/dto/update-price.dto.ts`, `radiology/dto/list-radiology-requisition.dto.ts`,
  `audit/dto/search-audit-records.dto.ts`, `inventory/dto/update-price.dto.ts`,
  `notifications/dto/search-notifications.dto.ts`, `billing/dto/list-invoices.dto.ts`,
  `billing/dto/list-deposits.dto.ts`.
- The other **95**, including the widely-reused `PaginationQueryDto`
  (`libs/pagination/src/dto/pagination-query.dto.ts` — `page?: number; limit?: number;`, no
  decorators), are plain classes with typed-but-undecorated fields.

This second fact changes the shape of the task. `ValidationPipe`'s `whitelist: true` option strips
any property that carries **zero** validation decorators — not just unrecognized properties. Turning
it on globally today would silently reduce all 95 undecorated DTOs' request bodies to `{}`, since
none of their fields have a single `@Is...()` decorator. That is a total-breakage change disguised as
a hardening change, and it's the actual reason 2.13's task note flagged this as needing the
heavyweight pipeline rather than a one-line fix — the risk isn't "the pipe rejects some requests",
it's "the pipe silently deletes almost every request body in the app."

## Solution

Split into two phases, only the first of which is this task's scope:

**Phase A (this task):** register a global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted` left **off**, `transform: true`, and
`transformOptions: { enableImplicitConversion: true }`. This:

- Activates real validation on the 9 already-decorated DTOs for the first time — closing the actual
  gap 2.13 exposed, with the class-validator errors those DTOs' authors already wrote.
- Coerces query/body values to the type each DTO field is *declared* as (via
  `emitDecoratorMetadata`'s `design:type` reflection, already enabled repo-wide per
  `new/code/CLAUDE.md`) even on fields with no explicit `@Type()` decorator — so `page`/`limit` on
  `PaginationQueryDto` and every other numeric query param arrive as actual numbers, not strings,
  without touching any of the 95 undecorated DTO files.
- Does **not** strip or reject a single existing field on any of the 95 undecorated DTOs, because
  `whitelist` stays off — their current behavior is unchanged, byte for byte.

**Phase B (new backlog item, not this task):** audit each of the 95 undecorated DTOs against its
real request payload, add the validators its fields warrant, then flip `whitelist: true` (and
consider `forbidNonWhitelisted: true`) once the audit is complete. That is the actual "every
controller gets validated for real, unexpected extra fields get rejected" hardening step, and it
deserves its own scoped pass rather than riding along here — see new backlog item below.

This keeps 2.14 honest to what it originally asked for (stop the 9 decorated DTOs' validators from
being dead code) while explicitly not doing the much larger, separately-risky whitelist migration
under the same commit.

## Implementation Decisions

### 1. Pipe registration

`main.ts`, via `app.useGlobalPipes(...)` (not `APP_PIPE` in `app.module.ts` — this repo has no other
global pipes, and `main.ts` already configures cross-cutting HTTP concerns like CORS and the global
prefix, so it's the natural home):

```ts
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    whitelist: false,
    forbidNonWhitelisted: false,
  }),
);
```

`whitelist`/`forbidNonWhitelisted` are listed explicitly (rather than left at their `false` default)
so the deferred decision is visible in the code, not just this doc.

### 2. Why `enableImplicitConversion` is safe here

It converts a field's incoming value to match the field's **declared TypeScript type** via reflected
metadata — a field typed `number` gets `Number(value)`, `boolean` gets boolean coercion, `string`
fields are left alone. It does not add or relax validation; a DTO with no `@Is...()` decorators still
has nothing enforcing shape, only its typed fields get coerced. The risk surface is "a numeric-looking
string in a field TypeScript declares as `string`" being wrongly coerced — not present in the 9
audited DTOs and not expected to matter for the 95 (their string fields are things like
`patientId`/`departmentId`, never numeric-looking).

### 3. What this does NOT change

- No DTO file is edited. The 9 already-decorated DTOs get their existing decorators activated as
  written — no new decorators added, no existing ones reinterpreted.
- No endpoint gains a new 400 path from an unexpected/extra field — `forbidNonWhitelisted` stays off.
- Swagger docs (`main.ts`'s `SwaggerModule`) are unaffected; it already reads DTO shapes statically.

### 4. New backlog item (Phase B, deferred)

Add to `claude-code-tasks.md`: audit and decorate the remaining 95 DTOs against their real request
payloads (frontend call sites + any Swagger/manual API consumers), then enable `whitelist: true` /
consider `forbidNonWhitelisted: true`. Flagged as its own heavyweight-pipeline item — it is the part
of the original 2.14 write-up that actually carries the "every controller validated for the first
time, could break in-flight requests" risk.

## Testing Decisions

Low-risk, single-behavior-class change (a global pipe with two additive, non-stripping options) —
lighter-weight test rigor than a tenant-isolation/money/PHI change, per `CLAUDE.md`'s risk-scaling
rule, but still needs breadth given the blast radius is "every controller":

- **Full backend suite green** with the pipe active (`cd new/code && CI=true pnpm exec nx run
  api:test`) — the existing integration specs already exercise real HTTP requests through most
  controllers; a regression from implicit conversion would show up as an existing assertion failing,
  not a new test needed.
- **Targeted new tests** for the 9 now-active DTOs: at least one spec per DTO's owning module
  confirming a request that previously reached the service unvalidated now 400s on a malformed field
  (e.g. `update-price.dto.ts`'s price validator actually rejecting a negative/non-numeric price).
  Reuse existing integration spec files for those modules rather than new files.
- **Regression check for implicit conversion**: confirm `PaginationQueryDto`-based list endpoints
  (several modules) still paginate correctly with `page`/`limit` as query strings — this is the
  behavior 2.13 already depends on, so it's covered by that module's existing pagination tests
  passing, not a new test.

## Non-Goals

- Does not decorate or change behavior of any of the 95 undecorated DTOs (Phase B).
- Does not add `whitelist`/`forbidNonWhitelisted` (Phase B).
- Does not touch the frontend — no API contract changes, only server-side validation of payloads the
  frontend already sends correctly.
