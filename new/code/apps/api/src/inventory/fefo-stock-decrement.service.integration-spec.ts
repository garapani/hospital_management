import { BadRequestException } from '@nestjs/common';
import { FefoStockDecrementService } from './fefo-stock-decrement.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('FefoStockDecrementService (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: InventoryCatalogService;
  let fefo: FefoStockDecrementService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'fefo_decrement' });
    catalogService = new InventoryCatalogService(ctx.tenantConnection);
    fefo = new FefoStockDecrementService();
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const RECORDED_BY = '00000000-0000-0000-0000-0000000000e2';

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

  /** Seeds a stock batch + its balance directly, bypassing the procurement pipeline. */
  async function seedBatch(itemId: string, batchNumber: string, expiryDate: string | null, quantity: number) {
    return ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        const batchRepository = manager.getRepository(StockBatch);
        const batch = await batchRepository.save(
          batchRepository.create({ itemId, batchNumber, expiryDate, unitCost: '10', mrp: '15' }),
        );
        const balanceRepository = manager.getRepository(StockBalance);
        await balanceRepository.save(
          balanceRepository.create({ itemId, stockBatchId: batch.id, availableQuantity: String(quantity) }),
        );
        return batch;
      }),
    );
  }

  function decrement(itemId: string, quantity: number, referenceId: string) {
    return ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        fefo.decrementInTransaction(manager, {
          itemId,
          quantity,
          transactionType: 'Dispense',
          referenceId,
          recordedBy: RECORDED_BY,
        }),
      ),
    );
  }

  async function getTransactions(itemId: string, referenceId: string) {
    return ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(StockTransaction).find({ where: { itemId, referenceId } }),
      ),
    );
  }

  it('never decrements an expired batch, even though it sorts first by expiry date', async () => {
    const item = await makeItem('fefo-expired');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expiredBatch = await seedBatch(item.id, 'EXPIRED-1', yesterday, 100);
    const validBatch = await seedBatch(item.id, 'VALID-1', nextYear, 50);

    await decrement(item.id, 10, '00000000-0000-0000-0000-0000000000f1');

    const transactions = await getTransactions(item.id, '00000000-0000-0000-0000-0000000000f1');
    expect(transactions).toHaveLength(1);
    expect(transactions[0].stockBatchId).toBe(validBatch.id);
    expect(transactions[0].stockBatchId).not.toBe(expiredBatch.id);
  });

  it('throws insufficient-stock rather than falling back to expired stock', async () => {
    const item = await makeItem('fefo-expired-insufficient');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await seedBatch(item.id, 'EXPIRED-2', yesterday, 100);

    await expect(decrement(item.id, 1, '00000000-0000-0000-0000-0000000000f2')).rejects.toThrow(BadRequestException);
    await expect(decrement(item.id, 1, '00000000-0000-0000-0000-0000000000f2')).rejects.toThrow(/available 0/);
  });

  it('still applies FEFO ordering among non-expired batches', async () => {
    const item = await makeItem('fefo-ordering');
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const soonBatch = await seedBatch(item.id, 'SOON-1', soon, 5);
    await seedBatch(item.id, 'LATER-1', later, 50);

    await decrement(item.id, 5, '00000000-0000-0000-0000-0000000000f3');

    const transactions = await getTransactions(item.id, '00000000-0000-0000-0000-0000000000f3');
    expect(transactions).toHaveLength(1);
    expect(transactions[0].stockBatchId).toBe(soonBatch.id);
  });

  it('treats a batch with no expiry date as usable, ordered after dated batches', async () => {
    const item = await makeItem('fefo-no-expiry');
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const datedBatch = await seedBatch(item.id, 'DATED-1', soon, 5);
    const noExpiryBatch = await seedBatch(item.id, 'NO-EXPIRY-1', null, 50);

    await decrement(item.id, 10, '00000000-0000-0000-0000-0000000000f4');

    const transactions = await getTransactions(item.id, '00000000-0000-0000-0000-0000000000f4');
    const byBatch = new Map(transactions.map((t) => [t.stockBatchId, t]));
    expect(byBatch.has(datedBatch.id)).toBe(true);
    expect(byBatch.has(noExpiryBatch.id)).toBe(true);
  });
});
