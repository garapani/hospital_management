import { BadRequestException } from '@nestjs/common';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
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

  const ORDERED_BY = '00000000-0000-4000-8000-0000000000e1';

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

  function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  describe('recordGoodsReceipt', () => {
    it('atomically increments the stock balance and records a GoodsReceipt transaction', async () => {
      const item = await makeItem('receipt-atomic');
      const vendor = await makeVendor('Receipt Atomic Vendor');
      const po = await ctx.inTenant(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: ORDERED_BY,
          items: [{ itemId: item.id, orderedQuantity: 10, unitCost: 5 }],
        }),
      );
      const poItem = po.items[0];

      await ctx.inTenant(() =>
        procurementService.recordGoodsReceipt(poItem.id, {
          batchNumber: 'BATCH-ATOMIC-1',
          expiryDate: daysFromNow(30),
          unitCost: 5,
          receivedQuantity: 4,
          recordedBy: ORDERED_BY,
        }),
      );

      const balances = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockBalance).find({ where: { itemId: item.id } }),
        ),
      );
      expect(balances).toHaveLength(1);
      expect(Number(balances[0].availableQuantity)).toBe(4);

      // A second receipt into the same item/batch/expiry accumulates onto the same balance row
      // instead of creating a duplicate one (the ON CONFLICT ... DO UPDATE upsert).
      await ctx.inTenant(() =>
        procurementService.recordGoodsReceipt(poItem.id, {
          batchNumber: 'BATCH-ATOMIC-1',
          expiryDate: daysFromNow(30),
          unitCost: 5,
          receivedQuantity: 3,
          recordedBy: ORDERED_BY,
        }),
      );
      const balancesAfterSecondReceipt = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockBalance).find({ where: { itemId: item.id } }),
        ),
      );
      expect(balancesAfterSecondReceipt).toHaveLength(1);
      expect(Number(balancesAfterSecondReceipt[0].availableQuantity)).toBe(7);

      const transactions = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockTransaction).find({ where: { referenceId: poItem.id } }),
        ),
      );
      expect(transactions).toHaveLength(2);
      expect(transactions.every((t) => t.transactionType === 'GoodsReceipt')).toBe(true);
    });

    it('rejects receiving more than the ordered quantity', async () => {
      const item = await makeItem('receipt-over');
      const vendor = await makeVendor('Receipt Over Vendor');
      const po = await ctx.inTenant(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: ORDERED_BY,
          items: [{ itemId: item.id, orderedQuantity: 5, unitCost: 5 }],
        }),
      );
      const poItem = po.items[0];

      await expect(
        ctx.inTenant(() =>
          procurementService.recordGoodsReceipt(poItem.id, {
            batchNumber: 'BATCH-OVER-1',
            unitCost: 5,
            receivedQuantity: 6,
            recordedBy: ORDERED_BY,
          }),
        ),
      ).rejects.toThrow(BadRequestException);

      const balances = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockBalance).find({ where: { itemId: item.id } }),
        ),
      );
      expect(balances).toHaveLength(0);
    });

    it('rolls the purchase order up to PartiallyReceived, then Received once every line is fully received', async () => {
      const itemA = await makeItem('receipt-rollup-a');
      const itemB = await makeItem('receipt-rollup-b');
      const vendor = await makeVendor('Receipt Rollup Vendor');
      const po = await ctx.inTenant(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: ORDERED_BY,
          items: [
            { itemId: itemA.id, orderedQuantity: 5, unitCost: 5 },
            { itemId: itemB.id, orderedQuantity: 5, unitCost: 5 },
          ],
        }),
      );
      const [lineA, lineB] = po.items;

      await ctx.inTenant(() =>
        procurementService.recordGoodsReceipt(lineA.id, {
          batchNumber: 'BATCH-ROLLUP-A',
          unitCost: 5,
          receivedQuantity: 5,
          recordedBy: ORDERED_BY,
        }),
      );
      const afterFirstLine = await ctx.inTenant(() => procurementService.findOne(po.id));
      expect(afterFirstLine.status).toBe('PartiallyReceived');

      await ctx.inTenant(() =>
        procurementService.recordGoodsReceipt(lineB.id, {
          batchNumber: 'BATCH-ROLLUP-B',
          unitCost: 5,
          receivedQuantity: 5,
          recordedBy: ORDERED_BY,
        }),
      );
      const afterSecondLine = await ctx.inTenant(() => procurementService.findOne(po.id));
      expect(afterSecondLine.status).toBe('Received');
    });

    it('rejects an expiryDate already in the past', async () => {
      const item = await makeItem('receipt-past-expiry');
      const vendor = await makeVendor('Receipt Past Expiry Vendor');
      const po = await ctx.inTenant(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: ORDERED_BY,
          items: [{ itemId: item.id, orderedQuantity: 5, unitCost: 5 }],
        }),
      );
      const poItem = po.items[0];

      await expect(
        ctx.inTenant(() =>
          procurementService.recordGoodsReceipt(poItem.id, {
            batchNumber: 'BATCH-PAST-EXPIRY',
            expiryDate: daysFromNow(-1),
            unitCost: 5,
            receivedQuantity: 1,
            recordedBy: ORDERED_BY,
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listLowStockItems', () => {
    it('includes an item at or below reorderLevel, excludes one comfortably above it', async () => {
      const lowItem = await makeItem('low-stock-below');
      const okItem = await makeItem('low-stock-ok');
      const vendor = await makeVendor('Low Stock Vendor');

      await ctx.inTenant(() => catalogService.updateItem(lowItem.id, { reorderLevel: 10 }));
      await ctx.inTenant(() => catalogService.updateItem(okItem.id, { reorderLevel: 10 }));

      const po = await ctx.inTenant(() =>
        procurementService.createPurchaseOrder({
          vendorId: vendor.id,
          orderedBy: ORDERED_BY,
          items: [
            { itemId: lowItem.id, orderedQuantity: 5, unitCost: 5 },
            { itemId: okItem.id, orderedQuantity: 50, unitCost: 5 },
          ],
        }),
      );
      await ctx.inTenant(() =>
        procurementService.recordGoodsReceipt(po.items[0].id, {
          batchNumber: 'BATCH-LOW',
          unitCost: 5,
          receivedQuantity: 5,
          recordedBy: ORDERED_BY,
        }),
      );
      await ctx.inTenant(() =>
        procurementService.recordGoodsReceipt(po.items[1].id, {
          batchNumber: 'BATCH-OK',
          unitCost: 5,
          receivedQuantity: 50,
          recordedBy: ORDERED_BY,
        }),
      );

      const lowStock = await ctx.inTenant(() => procurementService.listLowStockItems());
      const itemIds = lowStock.map((row) => row.itemId);
      expect(itemIds).toContain(lowItem.id);
      expect(itemIds).not.toContain(okItem.id);
      const lowRow = lowStock.find((row) => row.itemId === lowItem.id);
      expect(Number(lowRow?.availableQuantity)).toBe(5);
    });

    it('includes an item with no stock batches at all, once it has a reorderLevel above zero', async () => {
      const neverStockedItem = await makeItem('low-stock-never-stocked');
      await ctx.inTenant(() => catalogService.updateItem(neverStockedItem.id, { reorderLevel: 5 }));

      const lowStock = await ctx.inTenant(() => procurementService.listLowStockItems());
      const row = lowStock.find((r) => r.itemId === neverStockedItem.id);
      expect(row).toBeDefined();
      expect(Number(row?.availableQuantity)).toBe(0);
    });

    it('excludes a deactivated item even if it is below reorderLevel', async () => {
      const item = await makeItem('low-stock-deactivated');
      await ctx.inTenant(() => catalogService.updateItem(item.id, { reorderLevel: 5 }));
      await ctx.inTenant(() => catalogService.deactivateItem(item.id));

      const lowStock = await ctx.inTenant(() => procurementService.listLowStockItems());
      expect(lowStock.map((row) => row.itemId)).not.toContain(item.id);
    });
  });

  describe('actor fields derive from the authenticated principal, never the caller-supplied value', () => {
    // Unlike ctx.inTenant(), this run() sets an accountId — exactly what
    // TenantContextMiddleware does for a real HTTP request (from req.authContext.sub). The
    // service must record THIS account, ignoring the spoofed value passed to it.
    const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

    function withActor<T>(work: () => Promise<T>): Promise<T> {
      return ctx.tenantContext.run(
        { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'actor-test' },
        work,
      );
    }

    it('createPurchaseOrder records the authenticated account as orderedBy, not the body value', async () => {
      const item = await makeItem('actor-po');
      const vendor = await makeVendor('Actor Vendor');
      const spoofed = '00000000-0000-4000-8000-0000000000ff';

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
      const spoofed = '00000000-0000-4000-8000-0000000000ff';

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
