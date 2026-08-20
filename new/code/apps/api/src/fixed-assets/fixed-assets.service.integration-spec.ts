import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FixedAssetsService, computeStraightLineValuation } from './fixed-assets.service.js';
import { FixedAssetNumberGeneratorService } from './fixed-asset-number-generator.service.js';
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
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

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
    const asset = await makeAsset(category.id, { purchaseCost: 120000, usefulLifeYears: 10, purchaseDate: '2024-01-01' });

    // Purchase 2024-01-01, read as of the run date (2026-08) -> 31 full months in service.
    const valuation = await ctx.inTenant(() => fixedAssetsService.getAssetValuation(asset.id));
    expect(valuation.monthsInService).toBe(31);
    expect(valuation.annualDepreciation).toBe(12000);
    expect(valuation.accumulatedDepreciation).toBe(31000);
    expect(valuation.bookValue).toBe(89000);
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
});
