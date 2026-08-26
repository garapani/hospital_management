import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LabCatalogService } from './lab/lab-catalog.service.js';
import { RadiologyCatalogService } from './radiology/radiology-catalog.service.js';
import { InventoryCatalogService } from './inventory/inventory-catalog.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from './testing/tenant-test-context.js';

describe('Catalog pricing (integration) — price on create and PATCH price endpoints', () => {
  let ctx: TenantTestContext;
  let labCatalogService: LabCatalogService;
  let radiologyCatalogService: RadiologyCatalogService;
  let inventoryCatalogService: InventoryCatalogService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'catalog_pricing' });
    labCatalogService = new LabCatalogService(ctx.tenantConnection);
    radiologyCatalogService = new RadiologyCatalogService(ctx.tenantConnection);
    inventoryCatalogService = new InventoryCatalogService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('accepts a price when creating a lab test, and PATCH updates it', async () => {
    const category = await ctx.inTenant(() => labCatalogService.createCategory({ name: 'Pricing' }));
    const test = await ctx.inTenant(() =>
      labCatalogService.createTest({
        categoryId: category.id,
        name: 'Priced Test',
        code: 'P-1',
        specimenType: 'Blood',
        price: 120.5,
      }),
    );
    expect(test.price).toBe(120.5);

    const updated = await ctx.inTenant(() => labCatalogService.updateTestPrice(test.id, 150));
    expect(updated.price).toBe(150);

    await expect(
      ctx.inTenant(() => labCatalogService.updateTestPrice(test.id, -1)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => labCatalogService.updateTestPrice('00000000-0000-0000-0000-000000000000', 10)),
    ).rejects.toThrow(NotFoundException);
  });

  it('accepts a price when creating a radiology imaging item, and PATCH updates it', async () => {
    const type = await ctx.inTenant(() => radiologyCatalogService.createType({ name: 'X-Ray' }));
    const item = await ctx.inTenant(() =>
      radiologyCatalogService.createItem({
        imagingTypeId: type.id,
        name: 'Chest X-Ray',
        price: 300,
      }),
    );
    expect(item.price).toBe(300);

    const updated = await ctx.inTenant(() => radiologyCatalogService.updateItemPrice(item.id, 350));
    expect(updated.price).toBe(350);

    await expect(
      ctx.inTenant(() => radiologyCatalogService.updateItemPrice(item.id, -5)),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a salePrice when creating an inventory item, and PATCH updates it', async () => {
    const category = await ctx.inTenant(() => inventoryCatalogService.createCategory({ name: 'Drugs' }));
    const subCategory = await ctx.inTenant(() =>
      inventoryCatalogService.createSubCategory({ categoryId: category.id, name: 'Syrups' }),
    );
    const item = await ctx.inTenant(() =>
      inventoryCatalogService.createItem({
        subCategoryId: subCategory.id,
        name: 'Cough Syrup',
        code: 'SYR-1',
        unitOfMeasure: 'bottle',
        salePrice: 90,
      }),
    );
    expect(item.salePrice).toBe(90);

    const updated = await ctx.inTenant(() => inventoryCatalogService.updateItemSalePrice(item.id, 99.5));
    expect(updated.salePrice).toBe(99.5);

    await expect(
      ctx.inTenant(() => inventoryCatalogService.updateItemSalePrice(item.id, -1)),
    ).rejects.toThrow(BadRequestException);
  });
});
