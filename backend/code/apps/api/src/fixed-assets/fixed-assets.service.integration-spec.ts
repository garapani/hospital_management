import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FixedAssetsService, computeStraightLineValuation } from './fixed-assets.service.js';
import { FixedAssetNumberGeneratorService } from './fixed-asset-number-generator.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';
import { JournalEntry, JournalLine } from '../accounting/entities/journal-entry.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('FixedAssetsService (integration)', () => {
  let ctx: TenantTestContext;
  let fixedAssetsService: FixedAssetsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'fixed_assets' });
    fixedAssetsService = new FixedAssetsService(
      ctx.tenantConnection,
      new FixedAssetNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
      new AccountingService(
        ctx.tenantConnection,
        new JournalNumberGeneratorService(ctx.tenantConnection),
        ctx.tenantContext,
      ),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';
  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'fixed-assets-test' },
      work,
    );
  }

  let seq = 0;
  async function makeCategory(suffix: string) {
    return ctx.inTenant(() => fixedAssetsService.createCategory({ name: `Category ${suffix}` }));
  }

  async function makeAsset(categoryId: string, overrides: Partial<Parameters<FixedAssetsService['createAsset']>[0]> = {}) {
    seq += 1;
    return ctx.inTenant(() =>
      fixedAssetsService.createAsset({
        categoryId,
        name: `Asset ${seq}`,
        purchaseDate: '2024-01-01',
        purchaseCost: 120000,
        usefulLifeYears: 10,
        ...overrides,
      }),
    );
  }

  it('creates categories and assets, generating sequential asset codes', async () => {
    const category = await makeCategory('main');
    const asset = await makeAsset(category.id, { name: 'MRI Machine', purchaseCost: 5000000, usefulLifeYears: 8 });

    expect(asset.assetCode).toMatch(/^AST-\d{4}-\d+$/);
    expect(asset.name).toBe('MRI Machine');
    expect(asset.purchaseCost).toBe(5000000);
    expect(asset.isActive).toBe(true);

    const second = await makeAsset(category.id);
    expect(second.assetCode).not.toBe(asset.assetCode);
  });

  it('validates asset inputs', async () => {
    const category = await makeCategory('validation');
    await expect(
      ctx.inTenant(() =>
        fixedAssetsService.createAsset({
          categoryId: category.id,
          name: 'Bad Cost',
          purchaseDate: '2024-01-01',
          purchaseCost: -1,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        fixedAssetsService.createAsset({
          categoryId: category.id,
          name: 'Bad Life',
          purchaseDate: '2024-01-01',
          purchaseCost: 1000,
          usefulLifeYears: 0,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        fixedAssetsService.createAsset({
          categoryId: category.id,
          name: 'Bad Condition',
          purchaseDate: '2024-01-01',
          purchaseCost: 1000,
          condition: 'Broken' as never,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        fixedAssetsService.createAsset({
          categoryId: '00000000-0000-0000-0000-000000000000',
          name: 'No Category',
          purchaseDate: '2024-01-01',
          purchaseCost: 1000,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists assets paginated and filterable by category and condition', async () => {
    const category = await makeCategory('list');
    await makeAsset(category.id);
    await makeAsset(category.id, { condition: 'Under Repair' });

    const all = await ctx.inTenant(() => fixedAssetsService.listAssets({}));
    expect(all.meta.total).toBeGreaterThanOrEqual(2);

    const byCategory = await ctx.inTenant(() => fixedAssetsService.listAssets({ categoryId: category.id }));
    expect(byCategory.meta.total).toBe(2);

    const repairs = await ctx.inTenant(() => fixedAssetsService.listAssets({ condition: 'Under Repair' }));
    expect(repairs.meta.total).toBeGreaterThanOrEqual(1);
    expect(repairs.data.every((a) => a.condition === 'Under Repair')).toBe(true);
  });

  it('computes straight-line depreciation on read', async () => {
    const category = await makeCategory('depreciation');
    const purchaseDate = '2024-01-01';
    const purchaseCost = 120000;
    const usefulLifeYears = 10;
    const asset = await makeAsset(category.id, { purchaseCost, usefulLifeYears, purchaseDate });

    // Recomputed from the actual run date rather than a hardcoded literal — the previous
    // hardcoded "31 months as of 2026-08" rotted the moment the calendar ticked into September
    // (review-comments.md "Two integration specs assert a hardcoded elapsed-time value against
    // the real wall clock"). computeStraightLineValuation is the same function the service calls,
    // so this still catches a real regression in the formula, just not via a frozen expectation.
    const expected = computeStraightLineValuation({
      purchaseDate,
      purchaseCost,
      usefulLifeYears,
      salvageValue: 0,
    });

    const valuation = await ctx.inTenant(() => fixedAssetsService.getAssetValuation(asset.id));
    expect(valuation.monthsInService).toBe(expected.monthsInService);
    expect(valuation.annualDepreciation).toBe(expected.annualDepreciation);
    expect(valuation.accumulatedDepreciation).toBe(expected.accumulatedDepreciation);
    expect(valuation.bookValue).toBe(expected.bookValue);
  });

  it('caps accumulated depreciation at cost minus salvage', () => {
    const valuation = computeStraightLineValuation(
      { purchaseDate: '2010-01-01', purchaseCost: 1000, usefulLifeYears: 2, salvageValue: 100 },
      new Date('2026-01-01'),
    );
    expect(valuation.accumulatedDepreciation).toBe(900); // capped, not 8000
    expect(valuation.bookValue).toBe(100);
  });

  it('accrues no depreciation when usefulLifeYears is null', () => {
    const valuation = computeStraightLineValuation(
      { purchaseDate: '2020-01-01', purchaseCost: 5000, usefulLifeYears: null, salvageValue: 0 },
      new Date('2026-01-01'),
    );
    expect(valuation.annualDepreciation).toBeNull();
    expect(valuation.accumulatedDepreciation).toBe(0);
    expect(valuation.bookValue).toBe(5000);
  });

  it('updates an asset and enforces condition/amount validation', async () => {
    const category = await makeCategory('update');
    const asset = await makeAsset(category.id);

    const updated = await ctx.inTenant(() =>
      fixedAssetsService.updateAsset(asset.id, { condition: 'Under Repair', purchaseCost: 150000, usefulLifeYears: 5 }),
    );
    expect(updated.condition).toBe('Under Repair');
    expect(updated.purchaseCost).toBe(150000);
    expect(updated.usefulLifeYears).toBe(5);

    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { purchaseCost: -5 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset('00000000-0000-0000-0000-000000000000', { name: 'x' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('deactivates and reactivates assets and categories (soft delete)', async () => {
    const category = await makeCategory('soft');
    const asset = await makeAsset(category.id);

    const deactivated = await ctx.inTenant(() => fixedAssetsService.deactivateAsset(asset.id));
    expect(deactivated.isActive).toBe(false);
    await expect(
      ctx.inTenant(() => fixedAssetsService.deactivateAsset(asset.id)),
    ).rejects.toThrow(ConflictException);
    const reactivated = await ctx.inTenant(() => fixedAssetsService.reactivateAsset(asset.id));
    expect(reactivated.isActive).toBe(true);

    await ctx.inTenant(() => fixedAssetsService.deactivateCategory(category.id));
    // Deactivated category still visible in the list, but rejects new assets under it.
    const categories = await ctx.inTenant(() => fixedAssetsService.listCategories());
    expect(categories.some((c) => c.id === category.id && !c.isActive)).toBe(true);
    await expect(
      ctx.inTenant(() =>
        fixedAssetsService.createAsset({
          categoryId: category.id,
          name: 'Late',
          purchaseDate: '2024-01-01',
          purchaseCost: 100,
        }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  describe('runDepreciationAccrual', () => {
    it('accrues a period charge for an eligible asset and stamps the accruing actor', async () => {
      const category = await makeCategory('accrual-eligible');
      // 120000 cost, 10yr life -> 12000/yr = 1000/mo. Purchased 2024-01-01; period 2025-01
      // (periodEnd = 2025-02-01) -> 13 months elapsed -> accumulated 13000.
      const asset = await makeAsset(category.id, { purchaseCost: 120000, usefulLifeYears: 10, purchaseDate: '2024-01-01' });

      // Other tests in this shared tenant schema also have eligible assets that happen to be
      // in period; find this test's own asset rather than assume the run touches only it.
      const entries = await withActor(() => fixedAssetsService.runDepreciationAccrual(1, 2025));
      const entry = entries.find((e) => e.assetId === asset.id)!;

      expect(entry).toBeDefined();
      expect(entry.periodMonth).toBe(1);
      expect(entry.periodYear).toBe(2025);
      expect(entry.depreciationAmount).toBe(13000);
      expect(entry.accumulatedDepreciation).toBe(13000);
      expect(entry.bookValue).toBe(107000);
      expect(entry.accruedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('charges only the incremental amount on a second period, cumulative across runs', async () => {
      const category = await makeCategory('accrual-cumulative');
      const asset = await makeAsset(category.id, { purchaseCost: 120000, usefulLifeYears: 10, purchaseDate: '2024-01-01' });

      await withActor(() => fixedAssetsService.runDepreciationAccrual(1, 2025));
      const entries = await withActor(() => fixedAssetsService.runDepreciationAccrual(2, 2025));
      const second = entries.find((e) => e.assetId === asset.id)!;

      expect(second).toBeDefined();
      expect(second.depreciationAmount).toBe(1000); // incremental, not the full 14000 cumulative
      expect(second.accumulatedDepreciation).toBe(14000);
      expect(second.bookValue).toBe(106000);
    });

    it('skips Retired assets, inactive assets, and assets with no usefulLifeYears', async () => {
      const category = await makeCategory('accrual-skip');
      const retired = await makeAsset(category.id, { name: 'Retired', usefulLifeYears: 5 });
      await ctx.inTenant(() => fixedAssetsService.updateAsset(retired.id, { condition: 'Retired' }));
      const noLife = await makeAsset(category.id, { name: 'No Life', usefulLifeYears: undefined });
      const inactive = await makeAsset(category.id, { name: 'Inactive', usefulLifeYears: 5 });
      await ctx.inTenant(() => fixedAssetsService.deactivateAsset(inactive.id));

      const entries = await withActor(() => fixedAssetsService.runDepreciationAccrual(3, 2025));

      expect(entries.some((e) => e.assetId === retired.id)).toBe(false);
      expect(entries.some((e) => e.assetId === noLife.id)).toBe(false);
      expect(entries.some((e) => e.assetId === inactive.id)).toBe(false);
    });

    it('is idempotent — re-running the same period skips assets that already have an entry', async () => {
      const category = await makeCategory('accrual-idempotent');
      const asset = await makeAsset(category.id, { purchaseCost: 60000, usefulLifeYears: 5 });

      const first = await withActor(() => fixedAssetsService.runDepreciationAccrual(4, 2025));
      const second = await withActor(() => fixedAssetsService.runDepreciationAccrual(4, 2025));

      expect(first.some((e) => e.assetId === asset.id)).toBe(true);
      expect(second.some((e) => e.assetId === asset.id)).toBe(false); // already has an entry — skipped

      const entries = await ctx.inTenant(() =>
        fixedAssetsService.listDepreciationEntries({ assetId: asset.id, month: 4, year: 2025 }),
      );
      expect(entries.data).toHaveLength(1);
    });

    it('validates month/year inputs', async () => {
      await expect(withActor(() => fixedAssetsService.runDepreciationAccrual(0, 2025))).rejects.toThrow(BadRequestException);
      await expect(withActor(() => fixedAssetsService.runDepreciationAccrual(13, 2025))).rejects.toThrow(BadRequestException);
      await expect(withActor(() => fixedAssetsService.runDepreciationAccrual(1, 1899))).rejects.toThrow(BadRequestException);
    });

    it('lists depreciation entries filterable by asset and period', async () => {
      const category = await makeCategory('accrual-list');
      const assetA = await makeAsset(category.id, { usefulLifeYears: 5 });
      const assetB = await makeAsset(category.id, { usefulLifeYears: 5 });
      await withActor(() => fixedAssetsService.runDepreciationAccrual(5, 2025));

      const forA = await ctx.inTenant(() => fixedAssetsService.listDepreciationEntries({ assetId: assetA.id }));
      expect(forA.data).toHaveLength(1);
      expect(forA.data[0].assetId).toBe(assetA.id);

      const forPeriod = await ctx.inTenant(() => fixedAssetsService.listDepreciationEntries({ month: 5, year: 2025 }));
      expect(forPeriod.data.map((e: { assetId: string }) => e.assetId)).toEqual(expect.arrayContaining([assetA.id, assetB.id]));
    });

    it('back-filling an earlier period charges the incremental amount, not ₹0', async () => {
      // P2: the prior-entry lookup used to take the highest period OVERALL — so a back-fill of
      // an earlier period compared its (smaller) accumulated figure against a later period's and
      // silently booked ₹0. The prior entry must be the latest one strictly before the period.
      const category = await makeCategory('accrual-backfill');
      const asset = await makeAsset(category.id, { purchaseCost: 120000, usefulLifeYears: 10, purchaseDate: '2024-01-01' });

      // Forward run: period 6/2025 -> 18 months elapsed -> accumulated 18000.
      await withActor(() => fixedAssetsService.runDepreciationAccrual(6, 2025));
      // Back-fill: period 3/2025 -> 15 months elapsed -> accumulated 15000; prior-before-3 is
      // nothing, so the charge is the full 15000, NOT max(0, 15000 - 18000) = 0.
      const backfilled = await withActor(() => fixedAssetsService.runDepreciationAccrual(3, 2025));
      const entry = backfilled.find((e) => e.assetId === asset.id)!;
      expect(entry.depreciationAmount).toBe(15000);
      expect(entry.accumulatedDepreciation).toBe(15000);
    });

    it('posts a Depreciation Expense / Accumulated Depreciation journal when a charge accrues', async () => {
      const category = await makeCategory('accrual-ledger');
      const asset = await makeAsset(category.id, { purchaseCost: 60000, usefulLifeYears: 5, purchaseDate: '2024-01-01' });
      const entries = await withActor(() => fixedAssetsService.runDepreciationAccrual(2, 2025));
      const entry = entries.find((e) => e.assetId === asset.id)!;
      expect(entry.depreciationAmount).toBeGreaterThan(0);

      const journal = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema(async (manager) => {
          const journalEntry = await manager.getRepository(JournalEntry).findOne({
            where: { sourceType: 'Depreciation', sourceId: entry.id },
          });
          if (!journalEntry) return null;
          const lines = await manager.getRepository(JournalLine).find({ where: { journalId: journalEntry.id } });
          return { ...journalEntry, lines };
        }),
      );
      expect(journal).not.toBeNull();
      expect(journal!.status).toBe('Posted');
      expect(
        journal!.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.DEPRECIATION_EXPENSE)?.debit,
      ).toBe(entry.depreciationAmount);
      expect(
        journal!.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.ACCUMULATED_DEPRECIATION)?.credit,
      ).toBe(entry.depreciationAmount);
    });
  });

  it('freezes the valuation inputs once depreciation entries exist', async () => {
    const category = await makeCategory('freeze-valuation');
    const asset = await makeAsset(category.id, { purchaseCost: 60000, usefulLifeYears: 5 });
    await withActor(() => fixedAssetsService.runDepreciationAccrual(6, 2026));

    // Cost/date/useful-life/salvage are what every persisted entry was computed from — frozen
    // once entries exist (P2); administrative fields stay editable.
    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { purchaseCost: 70000 })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { usefulLifeYears: 8 })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { salvageValue: 5000 })),
    ).rejects.toThrow(ConflictException);

    const renamed = await ctx.inTenant(() =>
      fixedAssetsService.updateAsset(asset.id, { name: 'Renamed after accrual' }),
    );
    expect(renamed.name).toBe('Renamed after accrual');
  });

  it('rejects a salvageValue above purchaseCost on create and update', async () => {
    const category = await makeCategory('salvage-bound');
    await expect(
      ctx.inTenant(() =>
        fixedAssetsService.createAsset({
          categoryId: category.id,
          name: 'Bad Salvage',
          purchaseDate: '2024-01-01',
          purchaseCost: 10000,
          salvageValue: 15000,
          usefulLifeYears: 5,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    const asset = await makeAsset(category.id, { purchaseCost: 10000, usefulLifeYears: 5 });
    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { salvageValue: 20000 })),
    ).rejects.toThrow(BadRequestException);
    // And the combination: raising cost first, then a salvage above it, is caught post-update.
    await ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { purchaseCost: 25000 }));
    await expect(
      ctx.inTenant(() => fixedAssetsService.updateAsset(asset.id, { salvageValue: 30000 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('serializes concurrent accrual runs — the second run skips duplicates instead of aborting', async () => {
    // Same shape as the payroll concurrent-run test: the run-level advisory lock serializes
    // the runs, so the second finds the first's entries and skips — no thrown 500 from the
    // (assetId, periodMonth, periodYear) unique constraint.
    const category = await makeCategory('accrual-concurrent');
    const asset = await makeAsset(category.id, { purchaseCost: 60000, usefulLifeYears: 5, purchaseDate: '2024-01-01' });

    const [first, second] = await Promise.allSettled([
      withActor(() => fixedAssetsService.runDepreciationAccrual(7, 2026)),
      withActor(() => fixedAssetsService.runDepreciationAccrual(7, 2026)),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');

    const createdByFirst = first.status === 'fulfilled' ? first.value.filter((e) => e.assetId === asset.id) : [];
    const createdBySecond = second.status === 'fulfilled' ? second.value.filter((e) => e.assetId === asset.id) : [];
    expect(createdByFirst.length + createdBySecond.length).toBe(1);

    const listing = await ctx.inTenant(() =>
      fixedAssetsService.listDepreciationEntries({ assetId: asset.id, month: 7, year: 2026 }),
    );
    expect(listing.meta.total).toBe(1);
  });
});
