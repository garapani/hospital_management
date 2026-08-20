import { BadRequestException } from '@nestjs/common';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
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
      ctx.tenantContext,
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

  describe('actor fields derive from the authenticated principal, never the caller-supplied value', () => {
    // Unlike ctx.inTenant(), this run() sets an accountId — exactly what
    // TenantContextMiddleware does for a real HTTP request (from req.authContext.sub). The
    // service must record THIS account, ignoring the spoofed value passed to it.
    const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

    function withActor<T>(work: () => Promise<T>): Promise<T> {
      return ctx.tenantContext.run(
        { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'actor-test' },
        work,
      );
    }

    it('createPurchaseOrder records the authenticated account as orderedBy, not the body value', async () => {
      const item = await makeItem('actor-po');
      const vendor = await makeVendor('Actor Vendor');
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const po = await withActor(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: spoofed,
          items: [{ itemId: item.id, orderedQuantity: 10, unitCost: 5 }],
        }),
      );
      expect(po.orderedBy).toBe(AUTHENTICATED_ACCOUNT);

      const persisted = await ctx.inTenant(() => procurementService.findOne(po.id));
      expect(persisted.orderedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('recordGoodsReceipt records the authenticated account as recordedBy, not the body value', async () => {
      const item = await makeItem('actor-gr');
      const vendor = await makeVendor('Actor GR Vendor');
      const po = await ctx.inTenant(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: ORDERED_BY,
          items: [{ itemId: item.id, orderedQuantity: 10, unitCost: 5 }],
        }),
      );
      const poItem = po.items[0];
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      await withActor(() =>
        procurementService.recordGoodsReceipt(poItem.id, {
          batchNumber: 'BATCH-ACTOR-1',
          unitCost: 5,
          receivedQuantity: 5,
          recordedBy: spoofed,
        }),
      );

      const transaction = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockTransaction).findOne({ where: { referenceId: poItem.id } }),
        ),
      );
      expect(transaction?.recordedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
