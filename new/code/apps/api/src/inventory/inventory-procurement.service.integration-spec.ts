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
