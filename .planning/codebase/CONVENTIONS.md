# Coding Conventions

**Analysis Date:** 2026-08-01

## Naming Patterns

**Files:**
- Kebab-case, `<name>.<layer>.ts` — `patients.service.ts`, `patients.controller.ts`, `patients.module.ts`
- DTOs: `<verb-noun>.dto.ts` under `dto/` subdir — `apps/api/src/patients/dto/create-patient.dto.ts`
- Entities: `<noun>.entity.ts` under `entities/` subdir — `apps/api/src/patients/entities/patient.entity.ts`
- Integration tests: `<subject>.integration-spec.ts`, co-located next to the file under test (not a separate `__tests__` dir) — `apps/api/src/patients/patients.service.integration-spec.ts`
- Migrations: `NNNN-kebab-description.ts` (zero-padded 4-digit sequence) — `apps/api/src/database/migrations/0017-create-reporting-tables.ts`. Two legacy migrations break this pattern (`0011_create_encounter_tables.ts`, `005_create_patient_tables.ts` use underscores/3-digit numbering) — do not replicate, follow the `NNNN-kebab-case.ts` form for new migrations.

**Functions/Methods:**
- camelCase, verb-first: `findOne`, `checkDuplicates`, `provisionTenant`, `runInTenantSchema`

**Classes:**
- PascalCase, suffixed by role: `PatientsService`, `PatientsController`, `PatientsModule`, `CreatePatientDto`, `Patient` (entity, no suffix)

**Variables:**
- camelCase; query builders conventionally named `qb`

## Code Style

**Formatting:**
- Prettier, config at `new/code/.prettierrc`: `{ "singleQuote": true }` (all other options default — 80 char width, semicolons, trailing commas per Prettier 3 defaults)
- `.prettierignore` at `new/code/.prettierignore`
- No ESLint config exists anywhere in the repo (confirmed via search) — lint is not enforced. Per `new/code/CLAUDE.md`, CI intentionally omits `lint`/`build`/`e2e` targets "rather than left in as silent no-ops" until real targets exist. Do not assume ESLint rules when writing code; follow the file's local style and Prettier formatting only.

**Module system:**
- ESM throughout (`"type": "module"` in library `package.json`s, `nodenext` module resolution in `tsconfig.base.json`)
- **Every relative import must use an explicit `.js` extension**, even in `.ts` source files: `from './patients.service.js'` not `from './patients.service'`. Jest's SWC transform does not catch missing extensions — only `tsc --build` (`typecheck` target) does. Always verify with `pnpm exec nx run-many -t typecheck test`.

## Import Organization

**Order (observed, not enforced by tooling):**
1. External packages (`@nestjs/common`, `typeorm`)
2. Workspace libraries (`@hospital/auth-guards`, `@hospital/tenant-context`)
3. Relative imports — services/DTOs/entities from the current or sibling module, `.js`-suffixed

**Path Aliases:**
- Workspace libraries imported by package name (`@hospital/<lib>`), backed by `pnpm-workspace.yaml` `packages: [libs/*]` and each library's own `package.json` — not raw TS path-mapping. A library that imports another workspace library needs an explicit `"@hospital/<other-lib>": "workspace:*"` dependency entry (TS path mapping alone is not sufficient for cross-library resolution).

## Error Handling

**Pattern:** Nest built-in HTTP exceptions thrown directly from service methods, not caught/wrapped in controllers.

```typescript
// apps/api/src/patients/patients.service.ts
if (duplicates.length > 0) {
  throw new ConflictException({
    message: 'Potential duplicate patient record(s) found',
    duplicates,
  });
}
...
if (!patient) {
  throw new NotFoundException(`Patient with ID "${id}" not found`);
}
```

- `NotFoundException` for missing records (`findOne` pattern: fetch-or-throw, then reused by `update`/`deactivate` which call `findOne` first to get the 404 check for free)
- `ConflictException` for business-rule violations (duplicate detection), often with a structured payload (`{ message, duplicates }`) rather than a plain string
- Controllers never contain try/catch — they are thin pass-throughs to service methods (see Module Design below); Nest's exception filters handle the HTTP response mapping

## Multi-Tenancy Pattern

- All data access goes through `TenantConnectionService.runInTenantSchema(async (manager) => {...})`, which resolves the request-scoped tenant's Postgres schema and hands back a scoped `EntityManager`. Services never construct their own connections or repositories directly against a default schema.
- Tenant identity flows through `TenantContextService` (`@hospital/tenant-context`), set via `tenantContext.run({ tenantId, correlationId }, async () => {...})` — used both by the real request pipeline and by tests to simulate a tenant-scoped context.

## Comments

**When to Comment:**
- Sparse. Inline comments used only to flag non-obvious business decisions or defensive fallbacks, e.g. `// API might return { order, items } or just order` in `apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts:132`
- No JSDoc/TSDoc found on public methods — types and names are expected to be self-documenting

## Function Design

**Size:** Service methods stay under ~40 lines; complex query building is inlined via `qb.andWhere(...)` chains rather than extracted into helpers (see `PatientsService.findAll`, `apps/api/src/patients/patients.service.ts:81`)

**Parameters:** Methods take a single DTO object (`CreatePatientDto`, `SearchPatientsDto`) rather than positional primitives, except for id-based lookups (`findOne(id: string)`) and combined id+dto updates (`update(id: string, dto: UpdatePatientDto)`)

**Return Values:** Async methods always return typed Promises (`Promise<Patient>`, `Promise<{ data: Patient[]; total: number; page: number; limit: number }>`); paginated list endpoints return an inline object literal type rather than a named response DTO

## Module Design

**Layering:** Controller → Service → `TenantConnectionService` (data layer). Controllers are pure delegation — every controller method body is a single line calling into the service and returning its result (see `apps/api/src/patients/patients.controller.ts`). All business logic, validation, and error-throwing lives in services.

**DTOs:**
- Plain classes with `!`-asserted required fields and `?`-optional fields — no `class-validator` decorators observed in the sampled DTOs (`apps/api/src/patients/dto/create-patient.dto.ts`) despite `class-validator`/`class-transformer` being installed dependencies. Do not assume validation decorators exist on a DTO; check the specific file.
- Nested DTOs for embedded relations use dedicated classes (`CreatePatientAddressDto`, `CreatePatientKinDto`) rather than inline object types.

**Authorization:**
- Controllers apply `@UseGuards(PermissionGuard)` at the class level and `@RequirePermission('resource.action')` per method, both from `@hospital/auth-guards` — permission strings follow a `<resource>.<action>` convention (`patients.create`, `patients.read`, `patients.update`, `patients.manage`).

**Exports:** No barrel files (`index.ts` re-exports) observed within `apps/api/src/*` feature modules — each file is imported directly by path.

---

*Convention analysis: 2026-08-01*
