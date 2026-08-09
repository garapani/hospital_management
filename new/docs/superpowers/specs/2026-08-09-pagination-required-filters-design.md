# Shared Pagination + Required-Filter Enforcement — Design Spec

**Source:** `pending-tasks.md`, "Dependencies worth calling out explicitly" — the cross-cutting gap
noting that `InventoryProcurementService.listByVendor` and
`InventoryRequisitionService.listByDepartment` silently return ALL tenant rows when their filter
query param is omitted, because TypeORM's `find({ where: { x: undefined } })` treats an `undefined`
filter as "omit this WHERE clause," not "match nothing." The note explicitly asked for "a shared
'require this query param or throw `BadRequestException`' helper" rather than per-module patches.

## Problem

Two problems, discovered together and fixed together because every affected call site needs both:

1. **Silent unfiltered listing.** `listByVendor`/`listByDepartment` (and, found during this
   session's review of a separate uncommitted pagination change, `LabWorkflowService
   .listByOrderItem` and `OrdersService.list`) all have the same shape: a controller accepts an
   optional filter query param, and when it's omitted the service's conditional
   `if (query.x) qb.where(...)` simply skips the WHERE clause instead of rejecting the request —
   returning every row in the tenant instead of the caller's evidently-intended subset.
2. **An in-flight, uncommitted `@hospital/pagination` library** (already in the working tree before
   this spec) added real pagination to these same endpoints plus `listStockBalances` and
   `PatientsService.findAll`, but has two defects of its own found during review: its
   `PaginationQueryDto` decorates `page`/`limit` with `class-validator` (`@IsOptional`,
   `@Max(100)`, etc.), but **no `ValidationPipe` is registered anywhere in this app** (`main.ts`,
   `app.module.ts` — neither), so those decorators are inert; and `OrdersService.list`'s prior
   manual `Math.min(limit, 100)` clamp was deleted in the same change and not replaced, making
   `limit` effectively unbounded again.

## Scope

**In scope:**
- A `requireParam(value, paramName)` helper in `@hospital/pagination`, throwing
  `BadRequestException` on `undefined`/empty string.
- Applied to exactly 4 services/methods: `InventoryProcurementService.listByVendor` (`vendorId`),
  `InventoryRequisitionService.listByDepartment` (`departmentId`), `LabWorkflowService
  .listByOrderItem` (`orderItemId`), `OrdersService.list` (`patientId`). All four share the same
  "list one parent entity's children" shape — the filter isn't optional narrowing, it's the only
  thing that makes the query meaningful.
- Removing `class-validator`/`class-transformer` from `PaginationQueryDto` and the lib's peer
  dependencies, replacing them with manual clamping inside `paginate()`/`paginateRaw()` — matching
  this codebase's existing convention (confirmed: zero other DTOs in this codebase use
  `class-validator`; Radiology's required-field fix used explicit service-layer guard clauses, not
  a validation pipe).
- Fixing the two pre-existing integration-spec assertions broken by the already-in-flight
  pagination response-shape change (`{data,total,page,limit}` → `{data,meta:{...}}`).
- New automated tests for the pagination lib and the 4 required-filter endpoints (see Testing).

**Explicitly out of scope, staying optional (not a defect, a deliberate exclusion):**
- `InventoryProcurementService.listStockBalances` (`itemId`) — a whole-tenant stock-level browse
  view, not "one parent's children"; an unfiltered call is a legitimate use case (e.g. a
  stock-overview screen).
- `PatientsService.findAll` (`q`/`phoneNumber`/`patientNo`) — genuinely optional free-text patient
  search by product design.
- Wiring a global (or even per-controller) `ValidationPipe` anywhere in the app — out of scope for
  this item; would change validation behavior for every existing/future DTO across the whole app,
  a much larger blast radius than this fix needs. `requireParam()` sidesteps the need for it
  entirely by not depending on `class-validator`/Nest's validation pipeline at all.

## Architecture

`@hospital/pagination` (already exists, uncommitted) keeps doing two independent jobs: pagination
(`paginate`/`paginateRaw`, `PaginatedResponseDto<T>`) and, newly, a generic required-param guard
(`requireParam`). No new libraries. No framework wiring changes (no `ValidationPipe`, no
`APP_PIPE`) — enforcement is plain code in the service layer, matching how every other
required-field check in this codebase already works.

## Components

- **`libs/pagination/src/dto/pagination-query.dto.ts`** — strip all `class-validator`/
  `class-transformer` decorators and imports. Becomes a plain
  `export class PaginationQueryDto { page?: number; limit?: number; }`.
- **`libs/pagination/src/utils/paginate.ts`** — replace `Number(options.page ?? 1)` /
  `Number(options.limit ?? 20)` with clamped, NaN-safe versions:
  `const page = Math.max(1, Number(options.page) || 1);` and
  `const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));` in both `paginate()`
  and `paginateRaw()`. `|| 1` / `|| 20` catches `NaN` from a missing or malformed query string the
  same way the deleted `orders.service.ts` clamp implicitly relied on `Number()` coercion.
- **`libs/pagination/src/utils/require-param.ts`** (new) —
  ```ts
  import { BadRequestException } from '@nestjs/common';

  export function requireParam(value: string | undefined, paramName: string): string {
    if (!value) {
      throw new BadRequestException(`${paramName} is required`);
    }
    return value;
  }
  ```
  Exported from `libs/pagination/src/index.ts` alongside the existing exports.
- **`libs/pagination/package.json`** — drop the `class-validator`/`class-transformer` peer
  dependencies; keep `typeorm` (still used by `paginate`/`paginateRaw`'s query-builder types).
- **4 service methods** — replace the `if (query.x) qb.where(...)` conditional with:
  ```ts
  const vendorId = requireParam(query.vendorId, 'vendorId');
  qb.where('po.vendorId = :vendorId', { vendorId });
  ```
  (same shape for `departmentId`, `orderItemId`, `patientId`). DTO fields stay TS-optional (`?:`)
  — they can genuinely arrive `undefined` over the wire; `requireParam` is what turns that into a
  rejection, not the type.
- **`listStockBalances`, `PatientsService.findAll`** — unchanged filter-optionality; only inherit
  the `paginate`/`paginateRaw` clamp fix like every other call site.

## Data Flow

Controller (`@Query() query: XDto`) → service calls `requireParam(query.filterField, 'filterField')`
first — throws `400` immediately, before any DB round-trip, if missing → builds the query with the
now-guaranteed-present filter → `paginate()`/`paginateRaw()` clamps `page`/`limit` and executes.

## Error Handling

Plain `BadRequestException` — Nest's built-in exception, already used elsewhere in this codebase,
produces the framework's standard `{statusCode:400, message, error:"Bad Request"}` shape. No new
error-handling machinery.

## Testing

Automated tests for this item (departs from the "manual verification only" pattern used by the
recent Phase 6 product-module specs — this is a guardrail/correctness fix, not new product
surface, and the required-filter 400-vs-200 boundary is exactly the kind of behavior worth pinning
with a regression test):

- **`libs/pagination` unit tests** (new): `paginate()`/`paginateRaw()` clamp behavior — `page < 1`
  → `1`, `limit > 100` → `100`, `limit < 1` → `1`, non-numeric/missing input → the documented
  default (`page: 1`, `limit: 20`). `requireParam()` — throws `BadRequestException` on `undefined`
  and `''`, returns the value unchanged otherwise.
- **Fix existing breakage**: `patients.controller.integration-spec.ts:177` and
  `orders.service.integration-spec.ts:191,207,213` — update `.total` references to `.meta.total`
  to match the already-in-flight response-shape change. Grep the full test suite for any other
  reference to the old flat `{data,total,page,limit}` shape on these two endpoints before
  considering this done — the three line numbers found during this session's review are a floor,
  not a guaranteed-complete list.
- **New integration coverage**, one case per affected endpoint (`listByVendor`,
  `listByDepartment`, `listByOrderItem`, `orders.list`): omitting the required filter returns
  `400`; supplying it returns the paginated, correctly-filtered result.

## Documentation Updates

- `pending-tasks.md`: the cross-cutting gap note (under "Dependencies worth calling out
  explicitly") gets a done summary in place, naming the shared `requireParam()` helper and the 4
  endpoints it was applied to, and explicitly naming `listStockBalances`/`PatientsService.findAll`
  as deliberately-excluded rather than missed.
- `review-comments.md`: the originating finding gets a **Resolved:** note pointing at this spec and
  its plan.
- `Development-Standards.md`: new section documenting the `@hospital/pagination` lib as the
  standard for any future paginated list endpoint, the `requireParam()` pattern for "list one
  parent's children" endpoints specifically (vs. legitimately-optional browse/search filters,
  which should stay optional), and the reasoning for not using `class-validator`/`ValidationPipe`
  in this codebase.
