# Shared Pagination + Required-Filter Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix and finish the already-in-flight, uncommitted `@hospital/pagination` library so that
(1) `page`/`limit` are always clamped even though no `ValidationPipe` exists anywhere in this app,
and (2) four "list one parent's children" endpoints (Inventory's `listByVendor`/`listByDepartment`,
Lab's `listByOrderItem`, Orders' `list`) reject requests that omit their required filter instead of
silently returning every row in the tenant.

**Architecture:** `@hospital/pagination` keeps its existing `paginate`/`paginateRaw`/
`PaginatedResponseDto` exports, gains a new `requireParam()` guard function, and loses its
`class-validator`/`class-transformer` dependency (dead code — nothing in this app invokes a
validation pipe). Enforcement is plain code in each service's list method, matching this
codebase's existing pattern of explicit service-layer guard clauses (no `ValidationPipe`,
no decorators-as-validation anywhere).

**Tech Stack:** TypeScript, NestJS, TypeORM, Jest + `@swc/jest` (matching every other tested lib in
this workspace, e.g. `libs/auth-guards`). No new runtime dependencies.

## Global Constraints

- **No `ValidationPipe`, `APP_PIPE`, or `@UsePipes` anywhere in this plan.** Confirmed absent from
  `apps/api/src/main.ts` and `apps/api/src/app/app.module.ts`; introducing one is explicitly out of
  scope (see spec's Scope section) — enforcement must be plain code, not framework validation.
- **`requireParam(value, paramName)` exact signature and behavior** (from the spec, copy verbatim):
  ```ts
  import { BadRequestException } from '@nestjs/common';

  export function requireParam(value: string | undefined, paramName: string): string {
    if (!value) {
      throw new BadRequestException(`${paramName} is required`);
    }
    return value;
  }
  ```
- **Clamp formulas** (from the spec, copy verbatim, used in both `paginate()` and `paginateRaw()`):
  ```ts
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  ```
- **Exactly 4 services get `requireParam()` enforcement** — `InventoryProcurementService
  .listByVendor` (`vendorId`), `InventoryRequisitionService.listByDepartment` (`departmentId`),
  `LabWorkflowService.listByOrderItem` (`orderItemId`), `OrdersService.list` (`patientId`).
  `InventoryProcurementService.listStockBalances` (`itemId`) and `PatientsService.findAll`
  (`q`/`phoneNumber`/`patientNo`) are explicitly excluded — do not touch their filter logic, only
  let them inherit the `paginate`/`paginateRaw` clamp fix.
- **DTO fields stay TypeScript-optional (`?:`)** on all 4 required filters — the type reflects that
  they can genuinely arrive `undefined` over the wire; `requireParam()` is what turns that into a
  rejection, not the type system.
- **No controller changes anywhere in this plan.** Every touched controller already does
  `@Query() query: XDto` and passes the whole object to its service (already-in-flight, uncommitted
  work did this part correctly) — only the 4 services' method bodies and the pagination lib change.
- Never `git commit --amend`. Every task below is its own commit. No `Co-Authored-By` trailer.

---

### Task 1: Add Jest test scaffold to `libs/pagination`

**Pre-approved:** the human partner explicitly signed off on this exact scaffold-copy during
planning (protected-file edit per `guard-config.sh` — `tsconfig.json`/`tsconfig.spec.json` match
its blocked pattern). Proceed without re-asking.

**Files:**
- Modify: `new/code/libs/pagination/tsconfig.json`
- Create: `new/code/libs/pagination/tsconfig.spec.json`
- Create: `new/code/libs/pagination/jest.config.cts`
- Create: `new/code/libs/pagination/.spec.swcrc`

**Interfaces:**
- Produces: a working `nx test pagination` target for Tasks 2 and 3 to add specs against.

- [ ] **Step 1: Copy the scaffold from `libs/auth-guards`, renamed for pagination**

`new/code/libs/pagination/tsconfig.spec.json`:
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

`new/code/libs/pagination/jest.config.cts`:
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
  displayName: '@hospital/pagination',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
```

`new/code/libs/pagination/.spec.swcrc`:
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

- [ ] **Step 2: Add the `tsconfig.spec.json` reference to `tsconfig.json`**

`new/code/libs/pagination/tsconfig.json` — add a second entry to `references`:
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

- [ ] **Step 3: Verify the target exists**

Run: `pnpm exec nx test pagination`
Expected: passes with "No tests found" (no `.spec.ts` files exist yet) — confirms the target is
wired, not that anything is tested yet.

- [ ] **Step 4: Commit**

```bash
git add new/code/libs/pagination/tsconfig.json new/code/libs/pagination/tsconfig.spec.json new/code/libs/pagination/jest.config.cts new/code/libs/pagination/.spec.swcrc
git commit -m "chore(pagination): add jest test scaffold"
```

---

### Task 2: Fix `PaginationQueryDto` and clamp logic in `paginate()`/`paginateRaw()`

**Files:**
- Modify: `new/code/libs/pagination/src/dto/pagination-query.dto.ts`
- Modify: `new/code/libs/pagination/src/utils/paginate.ts`
- Modify: `new/code/libs/pagination/package.json`
- Create: `new/code/libs/pagination/src/utils/paginate.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `paginate<T>(qb: SelectQueryBuilder<T>, options: {page?: number; limit?: number}): Promise<PaginatedResponseDto<T>>` and `paginateRaw<T>(qb, options): Promise<PaginatedResponseDto<T>>` — same signatures as before, only the internal clamp logic changes. `PaginationQueryDto` becomes `{ page?: number; limit?: number }` with no decorators.

- [ ] **Step 1: Write the failing tests**

`new/code/libs/pagination/src/utils/paginate.spec.ts`:
```ts
import { paginate } from './paginate.js';

function makeQueryBuilder(rows: { id: number }[]) {
  let skipped = 0;
  let taken = rows.length;
  return {
    skip(n: number) {
      skipped = n;
      return this;
    },
    take(n: number) {
      taken = n;
      return this;
    },
    async getManyAndCount() {
      const page = rows.slice(skipped, skipped + taken);
      return [page, rows.length] as const;
    },
  } as any;
}

describe('paginate', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));

  it('defaults to page 1, limit 20 when neither is supplied', async () => {
    const result = await paginate(makeQueryBuilder(rows), {});
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
    expect(result.meta.total).toBe(5);
    expect(result.meta.totalPages).toBe(1);
    expect(result.data).toHaveLength(5);
  });

  it('clamps page below 1 up to 1', async () => {
    const result = await paginate(makeQueryBuilder(rows), { page: 0 });
    expect(result.meta.page).toBe(1);
  });

  it('clamps negative page up to 1', async () => {
    const result = await paginate(makeQueryBuilder(rows), { page: -5 });
    expect(result.meta.page).toBe(1);
  });

  it('clamps limit above 100 down to 100', async () => {
    const result = await paginate(makeQueryBuilder(rows), { limit: 500 });
    expect(result.meta.limit).toBe(100);
  });

  it('clamps limit below 1 up to 1', async () => {
    const result = await paginate(makeQueryBuilder(rows), { limit: 0 });
    expect(result.meta.limit).toBe(1);
  });

  it('falls back to defaults for non-numeric input', async () => {
    const result = await paginate(makeQueryBuilder(rows), {
      page: Number('not-a-number'),
      limit: Number('not-a-number'),
    });
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec nx test pagination`
Expected: FAIL — current `paginate()` doesn't clamp `page`/`limit`, and the response shape check
against `result.meta.*` may already pass for defaults but fail the clamp-specific assertions
(`page: 0` currently stays `0`, `limit: 500` currently stays `500`).

- [ ] **Step 3: Fix `paginate()`/`paginateRaw()` with the clamp formulas**

`new/code/libs/pagination/src/utils/paginate.ts` (full replacement):
```ts
import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { PaginatedResponseDto } from '../dto/paginated-response.dto.js';

interface PaginationOptions {
  page?: number;
  limit?: number;
}

function resolvePageAndLimit(options: PaginationOptions): { page: number; limit: number } {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  return { page, limit };
}

export async function paginate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  options: PaginationOptions,
): Promise<PaginatedResponseDto<T>> {
  const { page, limit } = resolvePageAndLimit(options);
  const skip = (page - 1) * limit;

  qb.skip(skip).take(limit);
  const [data, total] = await qb.getManyAndCount();

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function paginateRaw<T>(
  qb: SelectQueryBuilder<any>,
  options: PaginationOptions,
): Promise<PaginatedResponseDto<T>> {
  const { page, limit } = resolvePageAndLimit(options);
  const skip = (page - 1) * limit;

  qb.skip(skip).take(limit);
  const [data, total] = await Promise.all([qb.getRawMany<T>(), qb.getCount()]);

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec nx test pagination`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Strip `class-validator`/`class-transformer` from `PaginationQueryDto`**

`new/code/libs/pagination/src/dto/pagination-query.dto.ts` (full replacement):
```ts
export class PaginationQueryDto {
  page?: number;
  limit?: number;
}
```

- [ ] **Step 6: Drop the now-unused peer dependencies**

`new/code/libs/pagination/package.json` — remove `class-validator` and `class-transformer` from
`peerDependencies`, keep `typeorm`:
```json
{
  "name": "@hospital/pagination",
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
  },
  "peerDependencies": {
    "typeorm": "^1.1.0"
  }
}
```

- [ ] **Step 7: Reinstall to update the lockfile**

Run: `pnpm install` (from `new/code/`)
Expected: `pnpm-lock.yaml` updates to drop `class-validator`/`class-transformer` from
`libs/pagination`'s resolved dependencies.

- [ ] **Step 8: Typecheck**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS — no other file in the repo imports `class-validator` via this lib (confirmed during
planning: zero other DTOs in this codebase use `class-validator` at all).

- [ ] **Step 9: Commit**

```bash
git add new/code/libs/pagination/src/dto/pagination-query.dto.ts new/code/libs/pagination/src/utils/paginate.ts new/code/libs/pagination/src/utils/paginate.spec.ts new/code/libs/pagination/package.json new/code/pnpm-lock.yaml
git commit -m "fix(pagination): clamp page/limit manually, drop inert class-validator decorators"
```

---

### Task 3: Add `requireParam()` helper

**Files:**
- Create: `new/code/libs/pagination/src/utils/require-param.ts`
- Create: `new/code/libs/pagination/src/utils/require-param.spec.ts`
- Modify: `new/code/libs/pagination/src/index.ts`

**Interfaces:**
- Produces: `requireParam(value: string | undefined, paramName: string): string`, exported from
  `@hospital/pagination`'s package root — this is what Tasks 4–7 import.

- [ ] **Step 1: Write the failing test**

`new/code/libs/pagination/src/utils/require-param.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { requireParam } from './require-param.js';

describe('requireParam', () => {
  it('returns the value when present', () => {
    expect(requireParam('vendor-123', 'vendorId')).toBe('vendor-123');
  });

  it('throws BadRequestException when undefined', () => {
    expect(() => requireParam(undefined, 'vendorId')).toThrow(BadRequestException);
    expect(() => requireParam(undefined, 'vendorId')).toThrow('vendorId is required');
  });

  it('throws BadRequestException when an empty string', () => {
    expect(() => requireParam('', 'departmentId')).toThrow(BadRequestException);
    expect(() => requireParam('', 'departmentId')).toThrow('departmentId is required');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec nx test pagination`
Expected: FAIL — `require-param.ts` does not exist yet.

- [ ] **Step 3: Implement**

`new/code/libs/pagination/src/utils/require-param.ts`:
```ts
import { BadRequestException } from '@nestjs/common';

export function requireParam(value: string | undefined, paramName: string): string {
  if (!value) {
    throw new BadRequestException(`${paramName} is required`);
  }
  return value;
}
```

- [ ] **Step 4: Add `@nestjs/common` as a peer dependency**

`new/code/libs/pagination/package.json` — add to `peerDependencies` (alongside `typeorm`):
```json
    "@nestjs/common": "^11.0.0",
```

Run: `pnpm install` (from `new/code/`)

- [ ] **Step 5: Export from the package root**

`new/code/libs/pagination/src/index.ts` (full replacement):
```ts
export * from './dto/pagination-query.dto.js';
export * from './dto/paginated-response.dto.js';
export * from './utils/paginate.js';
export * from './utils/require-param.js';
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm exec nx test pagination`
Expected: PASS, all 3 cases (plus Task 2's 6 — 9 total).

- [ ] **Step 7: Typecheck**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add new/code/libs/pagination/src/utils/require-param.ts new/code/libs/pagination/src/utils/require-param.spec.ts new/code/libs/pagination/src/index.ts new/code/libs/pagination/package.json new/code/pnpm-lock.yaml
git commit -m "feat(pagination): add requireParam() guard helper"
```

---

### Task 4: Enforce required `vendorId` on `InventoryProcurementService.listByVendor`

**Files:**
- Modify: `new/code/apps/api/src/inventory/inventory-procurement.service.ts`
- Create: `new/code/apps/api/src/inventory/inventory-procurement.service.integration-spec.ts`

**Interfaces:**
- Consumes: `requireParam` from `@hospital/pagination` (Task 3).
- Produces: `listByVendor(query: SearchPurchaseOrdersDto): Promise<PaginatedResponseDto<PurchaseOrder>>` — same signature, now throws `BadRequestException` when `query.vendorId` is missing instead of silently omitting the filter.

- [ ] **Step 1: Write the failing tests**

`new/code/apps/api/src/inventory/inventory-procurement.service.integration-spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InventoryProcurementService.listByVendor (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: InventoryCatalogService;
  let procurementService: InventoryProcurementService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'inv_procurement_list' });
    catalogService = new InventoryCatalogService(ctx.tenantConnection);
    procurementService = new InventoryProcurementService(
      ctx.tenantConnection,
      new PurchaseOrderNumberGeneratorService(ctx.tenantConnection),
      catalogService,
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  async function makeItem(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await catalogService.createCategory({ name: `Category ${suffix}` });
      const subCategory = await catalogService.createSubCategory({
        categoryId: category.id,
        name: `SubCategory ${suffix}`,
      });
      return catalogService.createItem({
        subCategoryId: subCategory.id,
        name: `Item ${suffix}`,
        code: `ITEM-${suffix}`,
        unitOfMeasure: 'unit',
      });
    });
  }

  async function makeVendor(name: string) {
    return ctx.inTenant(() => catalogService.createVendor({ name }));
  }

  const ORDERED_BY = '00000000-0000-0000-0000-0000000000e1';

  it('throws BadRequestException when vendorId is omitted', async () => {
    await expect(
      ctx.inTenant(() => procurementService.listByVendor({} as any)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => procurementService.listByVendor({} as any)),
    ).rejects.toThrow('vendorId is required');
  });

  it('returns only the requested vendor\'s purchase orders, paginated', async () => {
    const item = await makeItem('vendor-filter');
    const vendorA = await makeVendor('Vendor A');
    const vendorB = await makeVendor('Vendor B');

    await ctx.inTenant(() =>
      procurementService.createPurchaseOrder({
        vendorId: vendorA.id,
        orderedBy: ORDERED_BY,
        items: [{ itemId: item.id, orderedQuantity: 10, unitCost: 5 }],
      }),
    );
    await ctx.inTenant(() =>
      procurementService.createPurchaseOrder({
        vendorId: vendorB.id,
        orderedBy: ORDERED_BY,
        items: [{ itemId: item.id, orderedQuantity: 10, unitCost: 5 }],
      }),
    );

    const result = await ctx.inTenant(() =>
      procurementService.listByVendor({ vendorId: vendorA.id }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].vendorId).toBe(vendorA.id);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec nx test api --testPathPattern=inventory-procurement.service.integration-spec`
Expected: FAIL on the first test (`listByVendor({})` currently returns an empty paginated result
instead of throwing).

- [ ] **Step 3: Wire `requireParam()` into `listByVendor`**

`new/code/apps/api/src/inventory/inventory-procurement.service.ts` — update the import and method:
```ts
import { paginate, paginateRaw, PaginatedResponseDto, requireParam } from '@hospital/pagination';
```
```ts
  async listByVendor(query: SearchPurchaseOrdersDto): Promise<PaginatedResponseDto<PurchaseOrder>> {
    const vendorId = requireParam(query.vendorId, 'vendorId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(PurchaseOrder).createQueryBuilder('po');
      qb.where('po.vendorId = :vendorId', { vendorId });
      qb.orderBy('po.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }
```

Leave `listStockBalances` (below it in the same file) untouched — `itemId` stays optional per the
spec's explicit exclusion.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec nx test api --testPathPattern=inventory-procurement.service.integration-spec`
Expected: PASS, both cases.

- [ ] **Step 5: Full typecheck + test run**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/inventory/inventory-procurement.service.ts new/code/apps/api/src/inventory/inventory-procurement.service.integration-spec.ts
git commit -m "fix(inventory): require vendorId on listByVendor instead of silently returning all rows"
```

---

### Task 5: Enforce required `departmentId` on `InventoryRequisitionService.listByDepartment`

**Files:**
- Modify: `new/code/apps/api/src/inventory/inventory-requisition.service.ts`
- Create: `new/code/apps/api/src/inventory/inventory-requisition.service.integration-spec.ts`

**Interfaces:**
- Consumes: `requireParam` from `@hospital/pagination` (Task 3).
- Produces: `listByDepartment(query: SearchStockRequisitionsDto): Promise<PaginatedResponseDto<StockRequisition>>` — same signature, now throws on missing `departmentId`.

- [ ] **Step 1: Write the failing tests**

`new/code/apps/api/src/inventory/inventory-requisition.service.integration-spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InventoryRequisitionService.listByDepartment (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: InventoryCatalogService;
  let masterDataService: MasterDataService;
  let requisitionService: InventoryRequisitionService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'inv_requisition_list' });
    catalogService = new InventoryCatalogService(ctx.tenantConnection);
    masterDataService = new MasterDataService(ctx.tenantConnection);
    requisitionService = new InventoryRequisitionService(
      ctx.tenantConnection,
      new StockRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      masterDataService,
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  async function makeItem(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await catalogService.createCategory({ name: `Category ${suffix}` });
      const subCategory = await catalogService.createSubCategory({
        categoryId: category.id,
        name: `SubCategory ${suffix}`,
      });
      return catalogService.createItem({
        subCategoryId: subCategory.id,
        name: `Item ${suffix}`,
        code: `ITEM-${suffix}`,
        unitOfMeasure: 'unit',
      });
    });
  }

  async function makeDepartment(code: string) {
    return ctx.inTenant(() =>
      masterDataService.createDepartment({ departmentCode: code, departmentName: `Dept ${code}` }),
    );
  }

  const REQUESTED_BY = '00000000-0000-0000-0000-0000000000e2';

  it('throws BadRequestException when departmentId is omitted', async () => {
    await expect(
      ctx.inTenant(() => requisitionService.listByDepartment({} as any)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => requisitionService.listByDepartment({} as any)),
    ).rejects.toThrow('departmentId is required');
  });

  it('returns only the requested department\'s requisitions, paginated', async () => {
    const item = await makeItem('dept-filter');
    const deptA = await makeDepartment('DEPT-A');
    const deptB = await makeDepartment('DEPT-B');

    await ctx.inTenant(() =>
      requisitionService.createRequisition({
        departmentId: deptA.id,
        requestedBy: REQUESTED_BY,
        items: [{ itemId: item.id, requestedQuantity: 5 }],
      }),
    );
    await ctx.inTenant(() =>
      requisitionService.createRequisition({
        departmentId: deptB.id,
        requestedBy: REQUESTED_BY,
        items: [{ itemId: item.id, requestedQuantity: 5 }],
      }),
    );

    const result = await ctx.inTenant(() =>
      requisitionService.listByDepartment({ departmentId: deptA.id }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].departmentId).toBe(deptA.id);
    expect(result.meta.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec nx test api --testPathPattern=inventory-requisition.service.integration-spec`
Expected: FAIL on the first test.

- [ ] **Step 3: Wire `requireParam()` into `listByDepartment`**

`new/code/apps/api/src/inventory/inventory-requisition.service.ts` — update the import and method:
```ts
import { paginate, PaginatedResponseDto, requireParam } from '@hospital/pagination';
```
```ts
  async listByDepartment(query: SearchStockRequisitionsDto): Promise<PaginatedResponseDto<StockRequisition>> {
    const departmentId = requireParam(query.departmentId, 'departmentId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(StockRequisition).createQueryBuilder('req');
      qb.where('req.departmentId = :departmentId', { departmentId });
      qb.orderBy('req.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec nx test api --testPathPattern=inventory-requisition.service.integration-spec`
Expected: PASS, both cases.

- [ ] **Step 5: Full typecheck + test run**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/inventory/inventory-requisition.service.ts new/code/apps/api/src/inventory/inventory-requisition.service.integration-spec.ts
git commit -m "fix(inventory): require departmentId on listByDepartment instead of silently returning all rows"
```

---

### Task 6: Enforce required `orderItemId` on `LabWorkflowService.listByOrderItem`

**Files:**
- Modify: `new/code/apps/api/src/lab/lab-workflow.service.ts`
- Create: `new/code/apps/api/src/lab/lab-workflow.service.integration-spec.ts`

**Interfaces:**
- Consumes: `requireParam` from `@hospital/pagination` (Task 3).
- Produces: `listByOrderItem(query: SearchLabRequisitionsDto): Promise<PaginatedResponseDto<LabRequisition>>` — same signature, now throws on missing `orderItemId`.

- [ ] **Step 1: Write the failing tests**

`new/code/apps/api/src/lab/lab-workflow.service.integration-spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('LabWorkflowService.listByOrderItem (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: LabCatalogService;
  let labWorkflowService: LabWorkflowService;
  let ordersService: OrdersService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'lab_workflow_list' });
    catalogService = new LabCatalogService(ctx.tenantConnection);
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
    );
    ordersService = new OrdersService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection));
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e3';

  async function makeOrderItem(phoneNumber: string) {
    return ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'Test',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber,
      });
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      });
      return order.items[0];
    });
  }

  async function makeTest(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await catalogService.createCategory({ name: `Category ${suffix}` });
      const test = await catalogService.createTest({
        categoryId: category.id,
        name: `Test ${suffix}`,
        code: `TEST-${suffix}`,
        specimenType: 'Blood',
      });
      await catalogService.createComponent(test.id, { name: 'Component 1' });
      return test;
    });
  }

  it('throws BadRequestException when orderItemId is omitted', async () => {
    await expect(
      ctx.inTenant(() => labWorkflowService.listByOrderItem({} as any)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => labWorkflowService.listByOrderItem({} as any)),
    ).rejects.toThrow('orderItemId is required');
  });

  it('returns only the requested order item\'s requisitions, paginated', async () => {
    const test = await makeTest('order-item-filter');
    const orderItemA = await makeOrderItem('4450000001');
    const orderItemB = await makeOrderItem('4450000002');

    await ctx.inTenant(() =>
      labWorkflowService.createRequisition({
        orderItemId: orderItemA.id,
        testId: test.id,
        specimenType: 'Blood',
      }),
    );
    await ctx.inTenant(() =>
      labWorkflowService.createRequisition({
        orderItemId: orderItemB.id,
        testId: test.id,
        specimenType: 'Blood',
      }),
    );

    const result = await ctx.inTenant(() =>
      labWorkflowService.listByOrderItem({ orderItemId: orderItemA.id }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].orderItemId).toBe(orderItemA.id);
    expect(result.meta.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec nx test api --testPathPattern=lab-workflow.service.integration-spec`
Expected: FAIL on the first test.

- [ ] **Step 3: Wire `requireParam()` into `listByOrderItem`**

`new/code/apps/api/src/lab/lab-workflow.service.ts` — update the import and method:
```ts
import { paginate, PaginatedResponseDto, requireParam } from '@hospital/pagination';
```
```ts
  async listByOrderItem(query: SearchLabRequisitionsDto): Promise<PaginatedResponseDto<LabRequisition>> {
    const orderItemId = requireParam(query.orderItemId, 'orderItemId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(LabRequisition).createQueryBuilder('req');
      qb.where('req.orderItemId = :orderItemId', { orderItemId });
      qb.orderBy('req.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec nx test api --testPathPattern=lab-workflow.service.integration-spec`
Expected: PASS, both cases.

- [ ] **Step 5: Full typecheck + test run**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/lab/lab-workflow.service.ts new/code/apps/api/src/lab/lab-workflow.service.integration-spec.ts
git commit -m "fix(lab): require orderItemId on listByOrderItem instead of silently returning all rows"
```

---

### Task 7: Enforce required `patientId` on `OrdersService.list`, fix broken existing tests

**Files:**
- Modify: `new/code/apps/api/src/orders/orders.service.ts`
- Modify: `new/code/apps/api/src/orders/orders.service.integration-spec.ts`

**Interfaces:**
- Consumes: `requireParam` from `@hospital/pagination` (Task 3).
- Produces: `list(query: SearchOrdersDto): Promise<PaginatedResponseDto<Order>>` — **signature change from before this plan's underlying uncommitted work**: the pre-existing test file still calls the old positional `list(patientId, page, limit)` shape and asserts the old flat `{data,total,page,limit}` response shape. Both must be updated to match the DTO-based signature and the new `{data,meta:{...}}` shape already in place in `orders.service.ts`.

- [ ] **Step 1: Update the existing tests to the new call signature and response shape (still failing — required-filter not wired yet)**

`new/code/apps/api/src/orders/orders.service.integration-spec.ts` — replace the 4 call sites and
their assertions (around what is currently lines 190–228):

```ts
  it('lists orders filtered by patientId', async () => {
    const patientA = await makePatient(tenantB, '4440000008');
    const patientB = await makePatient(tenantB, '4440000009');
    await tenantB.inTenant(() =>
      ordersService.create({ patientId: patientA.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );
    await tenantB.inTenant(() =>
      ordersService.create({ patientId: patientB.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'LFT' }] }),
    );

    const filtered = await tenantB.inTenant(() => ordersService.list({ patientId: patientA.id }));
    expect(filtered.meta.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
    expect(filtered.meta.page).toBe(1);
    expect(filtered.meta.limit).toBe(20);
  });

  it('paginates orders using page and limit', async () => {
    const patient = await makePatient(ctx, '4440000011');
    for (const description of ['CBC', 'LFT', 'RFT']) {
      await ctx.inTenant(() =>
        ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: description }] }),
      );
    }

    const firstPage = await ctx.inTenant(() => ordersService.list({ patientId: patient.id, page: 1, limit: 2 }));
    expect(firstPage.meta.total).toBe(3);
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.meta.page).toBe(1);
    expect(firstPage.meta.limit).toBe(2);

    const secondPage = await ctx.inTenant(() => ordersService.list({ patientId: patient.id, page: 2, limit: 2 }));
    expect(secondPage.meta.total).toBe(3);
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.meta.page).toBe(2);

    const firstPageIds = firstPage.data.map((order) => order.id);
    expect(firstPageIds).not.toContain(secondPage.data[0].id);
  });

  it('caps limit at 100 even when a larger value is requested', async () => {
    const patient = await makePatient(ctx, '4440000012');
    await ctx.inTenant(() =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );

    const result = await ctx.inTenant(() => ordersService.list({ patientId: patient.id, page: 1, limit: 500 }));
    expect(result.meta.limit).toBe(100);
  });
```

- [ ] **Step 2: Add the new required-filter test**

Add alongside the tests above (same file):
```ts
  it('throws BadRequestException when patientId is omitted', async () => {
    await expect(
      ctx.inTenant(() => ordersService.list({} as any)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => ordersService.list({} as any)),
    ).rejects.toThrow('patientId is required');
  });
```

Add `BadRequestException` to the existing `@nestjs/common` import at the top of the file (it
already imports `ConflictException`/`NotFoundException` from there).

- [ ] **Step 3: Grep the file for any other stale flat-shape reference**

Run: `grep -n "\.total\b\|\.page\b\|\.limit\b" new/code/apps/api/src/orders/orders.service.integration-spec.ts`
Expected: every remaining match is either `.meta.total`/`.meta.page`/`.meta.limit` (already fixed
above) or unrelated to pagination (e.g. `items` array lengths) — fix any further stale references
found here before proceeding.

- [ ] **Step 4: Run to verify the required-filter test fails, others pass**

Run: `pnpm exec nx test api --testPathPattern=orders.service.integration-spec`
Expected: the new "throws BadRequestException when patientId is omitted" test FAILs (not wired
yet); the shape/signature fixes from Steps 1–2 make the other pagination tests pass again against
the current (pre-`requireParam`) `list()` implementation.

- [ ] **Step 5: Wire `requireParam()` into `list()`**

`new/code/apps/api/src/orders/orders.service.ts` — update the import and method:
```ts
import { paginate, PaginatedResponseDto, requireParam } from '@hospital/pagination';
```
```ts
  async list(query: SearchOrdersDto): Promise<PaginatedResponseDto<Order>> {
    const patientId = requireParam(query.patientId, 'patientId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(Order).createQueryBuilder('order');
      qb.where('order.patientId = :patientId', { patientId });
      qb.orderBy('order.orderedAt', 'DESC');
      return paginate(qb, query);
    });
  }
```

- [ ] **Step 6: Run to verify all tests pass**

Run: `pnpm exec nx test api --testPathPattern=orders.service.integration-spec`
Expected: PASS, all cases including the new required-filter test.

- [ ] **Step 7: Full typecheck + test run**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add new/code/apps/api/src/orders/orders.service.ts new/code/apps/api/src/orders/orders.service.integration-spec.ts
git commit -m "fix(orders): require patientId on list, fix tests broken by paginated response shape"
```

---

### Task 8: Fix the broken `patients` HTTP response-shape assertion

**Files:**
- Modify: `new/code/apps/api/src/patients/patients.controller.integration-spec.ts`

**Interfaces:**
- Consumes: nothing new — `PatientsService.findAll` already returns `PaginatedResponseDto<Patient>` from the already-in-flight uncommitted work; only the test assertion is stale.

- [ ] **Step 1: Confirm the failure**

Run: `pnpm exec nx test api --testPathPattern=patients.controller.integration-spec`
Expected: FAIL at the `'lists patients with search query'` test — `response.body.total` is
`undefined` because the real value now lives at `response.body.meta.total`.

- [ ] **Step 2: Fix the assertion**

`new/code/apps/api/src/patients/patients.controller.integration-spec.ts` (around line 177) —
change:
```ts
      expect(response.body.total).toBeGreaterThanOrEqual(1);
```
to:
```ts
      expect(response.body.meta.total).toBeGreaterThanOrEqual(1);
```

- [ ] **Step 3: Grep for any other stale reference in this file**

Run: `grep -n "\.body\.total\|\.body\.page\|\.body\.limit" new/code/apps/api/src/patients/patients.controller.integration-spec.ts`
Expected: no remaining matches after Step 2's fix.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec nx test api --testPathPattern=patients.controller.integration-spec`
Expected: PASS.

- [ ] **Step 5: Full typecheck + test run**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS — this confirms every touched file across Tasks 2–8 compiles and passes together.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/patients/patients.controller.integration-spec.ts
git commit -m "test(patients): fix search response assertion for paginated {data,meta} shape"
```

---

### Task 9: Update `pending-tasks.md`, `review-comments.md`, `Development-Standards.md`

**Files:**
- Modify: `new/docs/technical-design/pending-tasks.md`
- Modify: `new/docs/technical-design/review-comments.md`
- Modify: `new/docs/technical-design/Development-Standards.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `pending-tasks.md`**

In the "Dependencies worth calling out explicitly" section, replace the existing cross-cutting-gap
bullet (the one starting "**New gap, not yet its own item, cross-cutting**:
`InventoryProcurementService.listByVendor(vendorId: string)`...") with:

```markdown
- [x] **Cross-cutting gap, resolved**: `InventoryProcurementService.listByVendor`,
  `InventoryRequisitionService.listByDepartment`, `LabWorkflowService.listByOrderItem`, and
  `OrdersService.list` used to silently return ALL tenant rows when their filter query param was
  omitted (TypeORM's `find({ where: { x: undefined } })` drops the WHERE clause entirely). Done: a
  shared `requireParam()` helper in `@hospital/pagination` now throws `BadRequestException` when
  any of the four is omitted; see
  `new/docs/superpowers/plans/2026-08-09-pagination-required-filters.md`. Along the way, also
  fixed a real pagination-clamp regression discovered during this item's review (an in-flight,
  previously-uncommitted `@hospital/pagination` library had deleted `OrdersService.list`'s
  `Math.min(limit, 100)` clamp without replacing it — `limit` was effectively unbounded for a
  window). **Deliberately excluded, staying optional:**
  `InventoryProcurementService.listStockBalances` (`itemId`) and `PatientsService.findAll`
  (`q`/`phoneNumber`/`patientNo`) — both are legitimate whole-tenant browse/search views, not "list
  one parent's children."
```

- [ ] **Step 2: Add a new finding to `review-comments.md`, immediately marked resolved**

This gap was never previously logged as its own `review-comments.md` finding (only noted inline in
`pending-tasks.md`). Add one now, matching the file's existing format (`### Severity: Title`, body
with file:line evidence, then a `**Resolved:**` note), inserted after the existing "Medium: Moved
docs contain stale path references" section and before `## Open Question`:

```markdown
### Medium: List endpoints silently return all tenant rows when their filter is omitted

**Resolved:** a shared `requireParam()` helper in `@hospital/pagination` now throws
`BadRequestException` when the filter is omitted on any of the four affected endpoints; see
`new/docs/superpowers/plans/2026-08-09-pagination-required-filters.md`.

`InventoryProcurementService.listByVendor(vendorId: string)`,
`InventoryRequisitionService.listByDepartment(departmentId: string)`,
`LabWorkflowService.listByOrderItem(orderItemId: string)`, and `OrdersService.list(patientId:
string)` all silently returned every row in the tenant (not an empty result, not an error) if
their filter parameter was omitted from the request, because TypeORM's `find({ where: { x:
undefined } })` treats an `undefined` filter value as "omit this WHERE clause entirely," not as
"match nothing":

- `new/code/apps/api/src/inventory/inventory-procurement.service.ts` (`listByVendor`)
- `new/code/apps/api/src/inventory/inventory-requisition.service.ts` (`listByDepartment`)
- `new/code/apps/api/src/lab/lab-workflow.service.ts` (`listByOrderItem`)
- `new/code/apps/api/src/orders/orders.service.ts` (`list`)

Not a privilege-escalation issue (anyone with the relevant `*.read` permission could already list
everything tenant-wide via other means), but a footgun for API correctness.
```

- [ ] **Step 3: Add a new `Development-Standards.md` section**

Append a new numbered section (match the existing `## N. Title` heading style used by the most
recent sections in this file — check the current highest section number and use the next integer):

```markdown
## <N>. Shared Pagination and Required-Filter Enforcement

Any new list endpoint that returns more than a handful of rows should use `@hospital/pagination`'s
`paginate()`/`paginateRaw()` — both clamp `page`/`limit` internally (`page` floors at 1; `limit`
floors at 1, ceilings at 100) regardless of what the caller sends, including non-numeric or
missing values. This clamping is manual code, not `class-validator`/`ValidationPipe` — this
codebase has no `ValidationPipe` registered anywhere (confirmed: `apps/api/src/main.ts` and
`app.module.ts` register none), and no other DTO in the codebase uses `class-validator` either, so
a decorator-based approach would be silently inert. `PaginatedResponseDto<T>`'s shape is
`{ data: T[], meta: { total, page, limit, totalPages } }` — note `total`/`page`/`limit` live under
`meta`, not at the response root.

For a list endpoint whose filter parameter scopes access to one parent entity's children (e.g.
"purchase orders for this vendor," "requisitions for this department") rather than narrowing an
otherwise-legitimate whole-tenant browse view, use `@hospital/pagination`'s `requireParam(value,
paramName)` at the top of the service method to reject the request with `BadRequestException` when
the filter is omitted, instead of letting TypeORM's `find({ where: { x: undefined } })` silently
drop the WHERE clause and return everything. Genuinely optional browse/search filters (e.g.
`PatientsService.findAll`'s `q`/`phoneNumber`/`patientNo`, or a whole-tenant stock-level view like
`listStockBalances`'s `itemId`) should stay optional — `requireParam()` is for "list one parent's
children," not every filterable field.
```

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/pending-tasks.md new/docs/technical-design/review-comments.md new/docs/technical-design/Development-Standards.md
git commit -m "docs: close out pagination + required-filter enforcement cross-cutting gap"
```
