import { BadRequestException, ConflictException } from '@nestjs/common';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { StockBatch } from '../inventory/entities/stock-batch.entity.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { StockTransaction } from '../inventory/entities/stock-transaction.entity.js';
import { FefoStockDecrementService } from '../inventory/fefo-stock-decrement.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PharmacyDispensingService (integration)', () => {
  let ctx: TenantTestContext;
  let inventoryCatalogService: InventoryCatalogService;
  let ordersService: OrdersService;
  let dispensingService: PharmacyDispensingService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'pharmacy_dispensing' });
    inventoryCatalogService = new InventoryCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    dispensingService = new PharmacyDispensingService(
      ctx.tenantConnection,
      new PharmacyDispensingNumberGeneratorService(ctx.tenantConnection),
      inventoryCatalogService,
      ordersService,
      new FefoStockDecrementService(),
      ctx.tenantContext,
    );
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e5';
  const PHARMACIST_ID = '00000000-0000-4000-8000-0000000000e8';

  async function makeOrderItem(phoneNumber: string, itemType = 'Pharmacy') {
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
        items: [{ itemType, itemDescription: 'Paracetamol 500mg' }],
      });
      return order.items[0];
    });
  }

  async function makeDrugItem(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await inventoryCatalogService.createCategory({ name: `Category ${suffix}` });
      const subCategory = await inventoryCatalogService.createSubCategory({
        categoryId: category.id,
        name: `SubCategory ${suffix}`,
        isConsumable: true,
      });
      return inventoryCatalogService.createItem({
        subCategoryId: subCategory.id,
        name: `Drug ${suffix}`,
        code: `DRUG-${suffix}`,
        unitOfMeasure: 'Tablet',
      });
    });
  }

  /** A future date (not a fixed literal — FEFO now excludes expired batches entirely, so a
   *  hardcoded past-relative date would make a batch invisible to FEFO instead of merely
   *  far-dated). */
  function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

  describe('createDispensing', () => {
    it('creates a dispensing for a valid Pharmacy order item', async () => {
      const item = await makeDrugItem('create');
      const orderItem = await makeOrderItem('4470000001');

      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 2 }),
      );

      expect(dispensing.status).toBe('Pending');
      expect(dispensing.orderItemId).toBe(orderItem.id);
    });

    it('rejects an order item that is not a Pharmacy order', async () => {
      const item = await makeDrugItem('wrong-type');
      const orderItem = await makeOrderItem('4470000002', 'Lab');

      await expect(
        ctx.inTenant(() =>
          dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate non-cancelled dispensing for the same order item', async () => {
      const item = await makeDrugItem('duplicate');
      const orderItem = await makeOrderItem('4470000003');

      await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );

      await expect(
        ctx.inTenant(() =>
          dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listPendingItems', () => {
    it('lists Pharmacy order items with patientId joined in, filterable by status', async () => {
      const pending = await makeOrderItem('4470000030');
      const labItem = await makeOrderItem('4470000031', 'Lab');

      const result = await ctx.inTenant(() => dispensingService.listPendingItems({ status: 'Pending', page: 1, limit: 50 }));

      const ids = result.data.map((r) => r.id);
      expect(ids).toContain(pending.id);
      expect(ids).not.toContain(labItem.id); // itemType filter always applies, even with a status filter

      const found = result.data.find((r) => r.id === pending.id)!;
      expect(found.patientId).toBeTruthy();
      expect(found.itemDescription).toBe('Paracetamol 500mg');
    });

    it('excludes non-Pharmacy order items regardless of status filter', async () => {
      const labItem = await makeOrderItem('4470000032', 'Lab');

      const result = await ctx.inTenant(() => dispensingService.listPendingItems({ page: 1, limit: 50 }));

      expect(result.data.map((r) => r.id)).not.toContain(labItem.id);
    });
  });

  describe('dispenseDrug — FEFO stock decrement', () => {
    it('consumes the nearer-expiry batch first, splitting across batches when needed', async () => {
      const item = await makeDrugItem('fefo');
      const nearBatch = await seedBatch(item.id, 'BATCH-NEAR', daysFromNow(30), 5);
      const farBatch = await seedBatch(item.id, 'BATCH-FAR', daysFromNow(400), 5);
      const orderItem = await makeOrderItem('4470000004');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 7 }),
      );

      const dispensed = await ctx.inTenant(() =>
        dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }),
      );
      expect(dispensed.status).toBe('Dispensed');

      const balances = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockBalance).find({ where: { itemId: item.id } }),
        ),
      );
      const nearBalance = balances.find((b) => b.stockBatchId === nearBatch.id);
      const farBalance = balances.find((b) => b.stockBatchId === farBatch.id);
      expect(Number(nearBalance?.availableQuantity)).toBe(0);
      expect(Number(farBalance?.availableQuantity)).toBe(3);

      const transactions = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager
            .getRepository(StockTransaction)
            .find({ where: { referenceId: dispensing.id }, order: { createdAt: 'ASC' } }),
        ),
      );
      expect(transactions).toHaveLength(2);
      expect(transactions.every((t) => t.transactionType === 'PharmacyDispense')).toBe(true);
      expect(Number(transactions[0].quantity)).toBe(5);
      expect(transactions[0].stockBatchId).toBe(nearBatch.id);
      expect(Number(transactions[1].quantity)).toBe(2);
      expect(transactions[1].stockBatchId).toBe(farBatch.id);

      // Confirms the OrdersService.completeItemInTransaction routing (not a raw repository
      // mutation) actually lands: the order item should be Completed after dispensing.
      const completedOrder = await ctx.inTenant(() => ordersService.findOne(orderItem.orderId));
      const completedItem = completedOrder.items.find((i) => i.id === orderItem.id);
      expect(completedItem?.status).toBe('Completed');
      expect(completedItem?.completedBy).toBe(PHARMACIST_ID);
    });

    it('treats a null expiryDate batch as consumed last', async () => {
      const item = await makeDrugItem('fefo-null-expiry');
      const noExpiryBatch = await seedBatch(item.id, 'BATCH-NO-EXPIRY', null, 5);
      const expiringBatch = await seedBatch(item.id, 'BATCH-EXPIRING', daysFromNow(10), 5);
      const orderItem = await makeOrderItem('4470000005');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 5 }),
      );

      await ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }));

      const balances = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockBalance).find({ where: { itemId: item.id } }),
        ),
      );
      const noExpiryBalance = balances.find((b) => b.stockBatchId === noExpiryBatch.id);
      const expiringBalance = balances.find((b) => b.stockBatchId === expiringBatch.id);
      expect(Number(expiringBalance?.availableQuantity)).toBe(0);
      expect(Number(noExpiryBalance?.availableQuantity)).toBe(5);
    });

    it('rejects dispensing more than the available stock', async () => {
      const item = await makeDrugItem('insufficient');
      await seedBatch(item.id, 'BATCH-SMALL', daysFromNow(30), 2);
      const orderItem = await makeOrderItem('4470000006');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 5 }),
      );

      await expect(
        ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dispensing when the dispensing is not Pending', async () => {
      const item = await makeDrugItem('not-pending');
      await seedBatch(item.id, 'BATCH-1', daysFromNow(30), 5);
      const orderItem = await makeOrderItem('4470000007');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );
      await ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }));

      await expect(
        ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID })),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a blank dispensedBy', async () => {
      const item = await makeDrugItem('blank-actor');
      await seedBatch(item.id, 'BATCH-1', daysFromNow(30), 5);
      const orderItem = await makeOrderItem('4470000008');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );

      await expect(
        ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: '' })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('cancels a Pending dispensing', async () => {
      const item = await makeDrugItem('cancel');
      const orderItem = await makeOrderItem('4470000009');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );

      const cancelled = await ctx.inTenant(() => dispensingService.cancel(dispensing.id, 'Prescription changed'));

      expect(cancelled.status).toBe('Cancelled');
      expect(cancelled.cancelReason).toBe('Prescription changed');
    });

    it('rejects cancelling an already-Dispensed record', async () => {
      const item = await makeDrugItem('cancel-guard');
      await seedBatch(item.id, 'BATCH-1', daysFromNow(30), 5);
      const orderItem = await makeOrderItem('4470000010');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );
      await ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }));

      await expect(ctx.inTenant(() => dispensingService.cancel(dispensing.id))).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reverseDispensing', () => {
    it('credits stock back across every batch the original dispense touched, and marks Reversed', async () => {
      const item = await makeDrugItem('reverse-fefo');
      const nearBatch = await seedBatch(item.id, 'BATCH-REV-NEAR', daysFromNow(30), 5);
      const farBatch = await seedBatch(item.id, 'BATCH-REV-FAR', daysFromNow(400), 5);
      const orderItem = await makeOrderItem('4470000020');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 7 }),
      );
      await ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }));

      const reversed = await ctx.inTenant(() =>
        dispensingService.reverseDispensing(dispensing.id, {
          reversedBy: PHARMACIST_ID,
          reversalReason: 'Wrong drug dispensed',
        }),
      );
      expect(reversed.status).toBe('Reversed');
      expect(reversed.reversedBy).toBe(PHARMACIST_ID);
      expect(reversed.reversalReason).toBe('Wrong drug dispensed');
      expect(reversed.reversedAt).toBeInstanceOf(Date);

      const balances = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockBalance).find({ where: { itemId: item.id } }),
        ),
      );
      expect(Number(balances.find((b) => b.stockBatchId === nearBatch.id)?.availableQuantity)).toBe(5);
      expect(Number(balances.find((b) => b.stockBatchId === farBatch.id)?.availableQuantity)).toBe(5);

      const reversalTransactions = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockTransaction).find({
            where: { referenceId: dispensing.id, transactionType: 'PharmacyDispenseReversal' },
          }),
        ),
      );
      expect(reversalTransactions).toHaveLength(2);
      expect(reversalTransactions.reduce((sum, t) => sum + Number(t.quantity), 0)).toBe(7);

      // Scope decision: reversal is stock-only — the order item stays Completed, it is not
      // reopened (code-review-findings-2026-08-25 pharmacy P2 discussion).
      const order = await ctx.inTenant(() => ordersService.findOne(orderItem.orderId));
      expect(order.items.find((i) => i.id === orderItem.id)?.status).toBe('Completed');
    });

    it('allows a new dispensing to be created against the same order item after reversal', async () => {
      const item = await makeDrugItem('reverse-redispense');
      await seedBatch(item.id, 'BATCH-REDISPENSE', daysFromNow(30), 5);
      const orderItem = await makeOrderItem('4470000021');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 2 }),
      );
      await ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }));
      await ctx.inTenant(() => dispensingService.reverseDispensing(dispensing.id, { reversedBy: PHARMACIST_ID }));

      const redispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 2 }),
      );
      expect(redispensing.status).toBe('Pending');
      expect(redispensing.id).not.toBe(dispensing.id);

      // Re-completing an already-Completed order item is a no-op (OrdersService.
      // completeItemInTransaction), so billing's charge-capture subscriber isn't re-triggered.
      const redispensed = await ctx.inTenant(() =>
        dispensingService.dispenseDrug(redispensing.id, { dispensedBy: PHARMACIST_ID }),
      );
      expect(redispensed.status).toBe('Dispensed');
    });

    it('rejects reversing a Pending dispensing', async () => {
      const item = await makeDrugItem('reverse-pending-guard');
      const orderItem = await makeOrderItem('4470000022');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );

      await expect(
        ctx.inTenant(() => dispensingService.reverseDispensing(dispensing.id, { reversedBy: PHARMACIST_ID })),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects reversing an already-Reversed dispensing', async () => {
      const item = await makeDrugItem('reverse-twice-guard');
      await seedBatch(item.id, 'BATCH-REVERSE-TWICE', daysFromNow(30), 5);
      const orderItem = await makeOrderItem('4470000023');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );
      await ctx.inTenant(() => dispensingService.dispenseDrug(dispensing.id, { dispensedBy: PHARMACIST_ID }));
      await ctx.inTenant(() => dispensingService.reverseDispensing(dispensing.id, { reversedBy: PHARMACIST_ID }));

      await expect(
        ctx.inTenant(() => dispensingService.reverseDispensing(dispensing.id, { reversedBy: PHARMACIST_ID })),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects reversing a Cancelled dispensing', async () => {
      const item = await makeDrugItem('reverse-cancelled-guard');
      const orderItem = await makeOrderItem('4470000024');
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({ orderItemId: orderItem.id, inventoryItemId: item.id, quantity: 1 }),
      );
      await ctx.inTenant(() => dispensingService.cancel(dispensing.id));

      await expect(
        ctx.inTenant(() => dispensingService.reverseDispensing(dispensing.id, { reversedBy: PHARMACIST_ID })),
      ).rejects.toThrow(ConflictException);
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

    let dispensingSeq = 0;
    async function makePendingDispensing() {
      dispensingSeq += 1;
      const item = await makeDrugItem(`actor-derivation-${dispensingSeq}`);
      await seedBatch(item.id, `BATCH-ACTOR-${dispensingSeq}`, daysFromNow(30), 5);
      const orderItem = await makeOrderItem(`44700000${String(10 + dispensingSeq).padStart(2, '0')}`);
      const dispensing = await ctx.inTenant(() =>
        dispensingService.createDispensing({
          orderItemId: orderItem.id,
          inventoryItemId: item.id,
          quantity: 1,
        }),
      );
      return { orderItem, dispensing };
    }

    it('dispenseDrug records the authenticated account as dispensedBy, not the caller-supplied value', async () => {
      const { orderItem, dispensing } = await makePendingDispensing();
      const spoofed = '00000000-0000-4000-8000-0000000000ff';

      const dispensed = await withActor(() =>
        dispensingService.dispenseDrug(dispensing.id, { dispensedBy: spoofed }),
      );
      expect(dispensed.dispensedBy).toBe(AUTHENTICATED_ACCOUNT);

      // The resolved actor also flows to the FEFO stock transactions and the completed order item.
      const transactions = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockTransaction).find({ where: { referenceId: dispensing.id } }),
        ),
      );
      expect(transactions).toHaveLength(1);
      expect(transactions[0].recordedBy).toBe(AUTHENTICATED_ACCOUNT);

      const completedOrder = await ctx.inTenant(() => ordersService.findOne(orderItem.orderId));
      const completedItem = completedOrder.items.find((i) => i.id === orderItem.id);
      expect(completedItem?.completedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('reverseDispensing records the authenticated account as reversedBy, not the caller-supplied value', async () => {
      const { dispensing } = await makePendingDispensing();
      const spoofed = '00000000-0000-4000-8000-0000000000ff';
      await withActor(() => dispensingService.dispenseDrug(dispensing.id, {}));

      const reversed = await withActor(() =>
        dispensingService.reverseDispensing(dispensing.id, { reversedBy: spoofed }),
      );
      expect(reversed.reversedBy).toBe(AUTHENTICATED_ACCOUNT);

      const reversalTransactions = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockTransaction).find({
            where: { referenceId: dispensing.id, transactionType: 'PharmacyDispenseReversal' },
          }),
        ),
      );
      expect(reversalTransactions).toHaveLength(1);
      expect(reversalTransactions[0].recordedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
