import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WardSupplyService } from './ward-supply.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('WardSupplyService (integration)', () => {
  let ctx: TenantTestContext;
  let wardSupplyService: WardSupplyService;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'ward_supply' });
    wardSupplyService = new WardSupplyService(ctx.tenantConnection, ctx.tenantContext);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'ward-supply-test' },
      work,
    );
  }

  let seq = 0;

  /** Inserts a real department row — ward-supply validates department existence via raw query. */
  async function makeDepartmentId(): Promise<string> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO departments ("departmentCode", "departmentName") VALUES ($1, $2) RETURNING id`,
          [`DEPT-${seq}`, `Department ${seq}`],
        ),
      ),
    );
    return rows[0].id;
  }

  /** Inserts a catalog item directly — ward-supply validates item existence via raw query only. */
  async function makeItem(name = 'Paracetamol'): Promise<{ id: string }> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO inventory_items ("subCategoryId", name, code, "unitOfMeasure")
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          ['00000000-0000-0000-0000-0000000000c1', name, `ITM-${seq}`, 'Tablet'],
        ),
      ),
    );
    return rows[0];
  }

  /** Inserts a real patient row — ward-supply validates patient existence via raw query. */
  async function makePatient(): Promise<string> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO patients ("patientNo", "firstName", "lastName", gender)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [`PT-${seq}`, 'Test', 'Patient', 'Male'],
        ),
      ),
    );
    return rows[0].id;
  }

  /** Inserts a real admission row (raw, like the nursing spec) — ward-supply validates via raw query. */
  async function makeAdmission(patientId: string): Promise<string> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO admissions ("patientId", "admissionSource", "admittingDoctorId", "wardId", "bedId")
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            patientId,
            'OPD',
            STAFF_ID,
            '00000000-0000-0000-0000-0000000000c2',
            `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
          ],
        ),
      ),
    );
    return rows[0].id;
  }

  async function getBatchRows(departmentId: string, itemId: string): Promise<Array<{ batchNumber: string; expiryDate: string | null; quantity: number }>> {
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `SELECT "batchNumber", "expiryDate"::text, quantity FROM ward_stock_batches
           WHERE "departmentId" = $1 AND "itemId" = $2
           ORDER BY "batchNumber"`,
          [departmentId, itemId],
        ),
      ),
    );
    return rows.map((r: { batchNumber: string; expiryDate: string | null; quantity: string }) => ({
      batchNumber: r.batchNumber,
      expiryDate: r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : null,
      quantity: Number(r.quantity),
    }));
  }

  it('receives stock into a ward balance (upserting) and records Receive transactions', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem();

    const first = await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 10, { performedBy: STAFF_ID }),
    );
    expect(first.availableQuantity).toBe(10);

    // Second receipt upserts the same (departmentId, itemId) balance instead of creating a row.
    const second = await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 5, {
        performedBy: STAFF_ID,
        remarks: 'Replenishment',
      }),
    );
    expect(second.availableQuantity).toBe(15);

    const balances = await ctx.inTenant(() => wardSupplyService.listBalances({ departmentId }));
    expect(balances.meta.total).toBe(1);
    expect(balances.data[0].itemId).toBe(item.id);
    expect(balances.data[0].availableQuantity).toBe(15);

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ departmentId }),
    );
    expect(transactions.meta.total).toBe(2);
    expect(transactions.data.every((t) => t.transactionType === 'Receive')).toBe(true);
    expect(transactions.data.map((t) => t.quantity).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(transactions.data.every((t) => t.performedBy === STAFF_ID)).toBe(true);
  });

  it('lists balances ordered by itemId across departments, paginated', async () => {
    const departmentId = await makeDepartmentId();
    const itemA = await makeItem('Amoxicillin');
    const itemB = await makeItem('Insulin');
    const itemC = await makeItem('Saline');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemB.id, 2, { performedBy: STAFF_ID }));
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemA.id, 3, { performedBy: STAFF_ID }));
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemC.id, 4, { performedBy: STAFF_ID }));

    const balances = await ctx.inTenant(() => wardSupplyService.listBalances({ departmentId }));
    expect(balances.meta.total).toBe(3);
    expect(balances.data.map((b) => b.itemId)).toEqual([itemA.id, itemB.id, itemC.id].sort());
    expect(balances.data.map((b) => b.availableQuantity).sort((a, b) => a - b)).toEqual([2, 3, 4]);

    // The same endpoint pages like every other list in the codebase.
    const page = await ctx.inTenant(() =>
      wardSupplyService.listBalances({ departmentId, limit: 2, page: 2 }),
    );
    expect(page.meta.page).toBe(2);
    expect(page.meta.limit).toBe(2);
    expect(page.meta.total).toBe(3);
    expect(page.meta.totalPages).toBe(2);
    expect(page.data).toHaveLength(1);
  });

  it('consumes stock, decrementing the balance and recording a Consume transaction', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Saline');
    const patientId = await makePatient();
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 10, { performedBy: STAFF_ID }));

    const after = await ctx.inTenant(() =>
      wardSupplyService.consumeStock(departmentId, item.id, 4, {
        patientId,
        performedBy: STAFF_ID,
        remarks: 'Ward usage',
      }),
    );
    expect(after.availableQuantity).toBe(6);

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ itemId: item.id }),
    );
    const consume = transactions.data.find((t) => t.transactionType === 'Consume');
    expect(consume).toBeDefined();
    expect(consume!.quantity).toBe(4);
    expect(consume!.patientId).toBe(patientId);
    expect(consume!.remarks).toBe('Ward usage');
    expect(consume!.performedBy).toBe(STAFF_ID);
  });

  it('rejects consumption beyond available stock with ConflictException', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Bandage');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 3, { performedBy: STAFF_ID }));

    await expect(
      ctx.inTenant(() => wardSupplyService.consumeStock(departmentId, item.id, 5, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);

    // No balance row at all for a different item -> also insufficient.
    const otherItem = await makeItem('Gauze');
    await expect(
      ctx.inTenant(() => wardSupplyService.consumeStock(departmentId, otherItem.id, 1, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);
  });

  it('validates quantities on receive and consume', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Syringe');
    await expect(
      ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 0, { performedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, -3, { performedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => wardSupplyService.consumeStock(departmentId, item.id, 0, { performedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    // Nothing was recorded by the rejected calls.
    const transactions = await ctx.inTenant(() => wardSupplyService.listTransactions({ departmentId }));
    expect(transactions.meta.total).toBe(0);
  });

  it('rejects receiving an unknown inventory item or department with NotFoundException', async () => {
    const departmentId = await makeDepartmentId();
    await expect(
      ctx.inTenant(() =>
        wardSupplyService.receiveStock(departmentId, '00000000-0000-0000-0000-000000000000', 5, {
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    const item = await makeItem('IV Set');
    await expect(
      ctx.inTenant(() =>
        wardSupplyService.receiveStock('00000000-0000-0000-0000-0000000000dd', item.id, 5, {
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('records batch provenance on receive and accumulates the same batch lot', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Insulin Vial');

    const first = await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 5, {
        batchNumber: 'LOT-2028',
        expiryDate: '2028-05-05',
        performedBy: STAFF_ID,
      }),
    );
    expect(first.availableQuantity).toBe(5);

    // A second receipt of the same lot accumulates onto the same batch row.
    await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 3, {
        batchNumber: 'LOT-2028',
        expiryDate: '2028-05-05',
        performedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 2, { performedBy: STAFF_ID }),
    );

    const batches = await getBatchRows(departmentId, item.id);
    expect(batches).toHaveLength(2);
    expect(batches.find((b) => b.batchNumber === 'LOT-2028')!.quantity).toBe(8);
    expect(batches.find((b) => b.batchNumber === 'LOT-2028')!.expiryDate).toBe('2028-05-05');
    expect(batches.find((b) => b.batchNumber === '')!.quantity).toBe(2);

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ itemId: item.id }),
    );
    const lotReceive = transactions.data.find((t) => t.batchNumber === 'LOT-2028');
    expect(lotReceive).toBeDefined();
    expect(lotReceive!.expiryDate).toBe('2028-05-05');
    expect(transactions.data.find((t) => t.transactionType === 'Receive' && t.batchNumber === null)).toBeDefined();
  });

  it('rejects an already-expired receipt and an expiryDate without a batchNumber', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Paracetamol');
    await expect(
      ctx.inTenant(() =>
        wardSupplyService.receiveStock(departmentId, item.id, 5, {
          batchNumber: 'OLD',
          expiryDate: '2020-01-01',
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        wardSupplyService.receiveStock(departmentId, item.id, 5, {
          expiryDate: '2030-01-01',
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    // Nothing was recorded.
    const transactions = await ctx.inTenant(() => wardSupplyService.listTransactions({ departmentId }));
    expect(transactions.meta.total).toBe(0);
  });

  it('consumes earliest-expiry lots first (FEFO) and records per-lot ledger entries', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Dextrose');
    await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 10, {
        batchNumber: 'LATE-2030',
        expiryDate: '2030-01-01',
        performedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 10, {
        batchNumber: 'EARLY-2028',
        expiryDate: '2028-01-01',
        performedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 5, { performedBy: STAFF_ID }),
    );

    const after = await ctx.inTenant(() =>
      wardSupplyService.consumeStock(departmentId, item.id, 12, { performedBy: STAFF_ID }),
    );
    expect(after.availableQuantity).toBe(13);

    const batches = await getBatchRows(departmentId, item.id);
    expect(batches.find((b) => b.batchNumber === 'EARLY-2028')!.quantity).toBe(0);
    expect(batches.find((b) => b.batchNumber === 'LATE-2030')!.quantity).toBe(8);
    expect(batches.find((b) => b.batchNumber === '')!.quantity).toBe(5);

    // Ledger: one Consume row per lot touched, carrying that lot's provenance.
    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ itemId: item.id, transactionType: 'Consume' }),
    );
    const early = transactions.data.find((t) => t.batchNumber === 'EARLY-2028');
    const late = transactions.data.find((t) => t.batchNumber === 'LATE-2030');
    expect(early!.quantity).toBe(10);
    expect(early!.expiryDate).toBe('2028-01-01');
    expect(late!.quantity).toBe(2);
    expect(late!.expiryDate).toBe('2030-01-01');
  });

  it('never consumes from an expired lot', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Oxygen Mask');
    await ctx.inTenant(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 10, {
        batchNumber: 'FRESH',
        expiryDate: '2030-01-01',
        performedBy: STAFF_ID,
      }),
    );
    // Simulate an expired lot sitting in the ward store (receiving already-expired stock is
    // rejected at the service, so this row is inserted directly to build the state).
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO ward_stock_batches ("departmentId", "itemId", "batchNumber", "expiryDate", "quantity")
           VALUES ($1, $2, 'EXPIRED', '2020-01-01', 5)`,
          [departmentId, item.id],
        ),
      ),
    );
    // Shrink the fresh lot so the balance (10) exceeds what is actually consumable (3).
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `UPDATE ward_stock_batches SET quantity = 3 WHERE "departmentId" = $1 AND "itemId" = $2 AND "batchNumber" = 'FRESH'`,
          [departmentId, item.id],
        ),
      ),
    );

    await expect(
      ctx.inTenant(() => wardSupplyService.consumeStock(departmentId, item.id, 4, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);

    // Consuming only what the fresh lot holds succeeds and leaves the expired lot untouched.
    const after = await ctx.inTenant(() =>
      wardSupplyService.consumeStock(departmentId, item.id, 3, { performedBy: STAFF_ID }),
    );
    expect(after.availableQuantity).toBe(7);
    const batches = await getBatchRows(departmentId, item.id);
    expect(batches.find((b) => b.batchNumber === 'EXPIRED')!.quantity).toBe(5);
  });

  it('validates patientId and admissionId on consumption', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Needle');
    const patientId = await makePatient();
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 10, { performedBy: STAFF_ID }));

    await expect(
      ctx.inTenant(() =>
        wardSupplyService.consumeStock(departmentId, item.id, 1, {
          patientId: '00000000-0000-0000-0000-0000000000f0',
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() =>
        wardSupplyService.consumeStock(departmentId, item.id, 1, {
          admissionId: '00000000-0000-0000-0000-0000000000f1',
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    // Both supplied and valid: succeeds.
    const admissionId = await makeAdmission(patientId);
    const after = await ctx.inTenant(() =>
      wardSupplyService.consumeStock(departmentId, item.id, 1, { patientId, admissionId, performedBy: STAFF_ID }),
    );
    expect(after.availableQuantity).toBe(9);
  });

  it('supports Return and Wastage ledger movements, and rejects over-return/wastage', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Bandage');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 10, { performedBy: STAFF_ID }));

    const returned = await ctx.inTenant(() =>
      wardSupplyService.returnStock(departmentId, item.id, 3, { performedBy: STAFF_ID, remarks: 'Surplus to central' }),
    );
    expect(returned.availableQuantity).toBe(7);
    const wasted = await ctx.inTenant(() =>
      wardSupplyService.wasteStock(departmentId, item.id, 2, { performedBy: STAFF_ID, remarks: 'Damaged pack' }),
    );
    expect(wasted.availableQuantity).toBe(5);

    await expect(
      ctx.inTenant(() => wardSupplyService.wasteStock(departmentId, item.id, 6, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ itemId: item.id }),
    );
    expect(transactions.data.find((t) => t.transactionType === 'Return')!.quantity).toBe(3);
    expect(transactions.data.find((t) => t.transactionType === 'Return')!.remarks).toBe('Surplus to central');
    expect(transactions.data.find((t) => t.transactionType === 'Wastage')!.quantity).toBe(2);
  });

  it('records Adjust movements as a signed delta and keeps balance and lots consistent', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Gauze');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 10, { performedBy: STAFF_ID }));

    // Positive stocktake correction.
    const up = await ctx.inTenant(() =>
      wardSupplyService.adjustStock(departmentId, item.id, 3, { performedBy: STAFF_ID, remarks: 'Stocktake surplus' }),
    );
    expect(up.availableQuantity).toBe(13);

    // Negative correction (FEFO across lots).
    const down = await ctx.inTenant(() =>
      wardSupplyService.adjustStock(departmentId, item.id, -5, { performedBy: STAFF_ID, remarks: 'Stocktake shortfall' }),
    );
    expect(down.availableQuantity).toBe(8);

    const batches = await getBatchRows(departmentId, item.id);
    expect(batches.find((b) => b.batchNumber === '')!.quantity).toBe(8);

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ itemId: item.id, transactionType: 'Adjust' }),
    );
    expect(transactions.data.map((t) => t.quantity).sort((a, b) => a - b)).toEqual([-5, 3]);

    // Zero is rejected, and an adjustment that would go negative is refused without mutating.
    await expect(
      ctx.inTenant(() => wardSupplyService.adjustStock(departmentId, item.id, 0, { performedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => wardSupplyService.adjustStock(departmentId, item.id, -9, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);
    const after = await ctx.inTenant(() => wardSupplyService.listBalances({ departmentId }));
    expect(after.data[0].availableQuantity).toBe(8);
  });

  it('derives performedBy from the authenticated principal, ignoring spoofed values', async () => {
    const departmentId = await makeDepartmentId();
    const item = await makeItem('IV Set');

    const balance = await withActor(() =>
      wardSupplyService.receiveStock(departmentId, item.id, 8, { performedBy: 'spoofed' }),
    );
    expect(balance.availableQuantity).toBe(8);

    await withActor(() =>
      wardSupplyService.consumeStock(departmentId, item.id, 2, { performedBy: 'spoofed' }),
    );

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ itemId: item.id }),
    );
    expect(transactions.data).toHaveLength(2);
    expect(transactions.data.every((t) => t.performedBy === AUTHENTICATED_ACCOUNT)).toBe(true);
  });

  it('paginates and filters transactions, newest first', async () => {
    const departmentId = await makeDepartmentId();
    const itemA = await makeItem('Dextrose');
    const itemB = await makeItem('Needle');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemA.id, 5, { performedBy: STAFF_ID }));
    await new Promise((resolve) => setTimeout(resolve, 10)); // distinct performedAt timestamps
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemB.id, 5, { performedBy: STAFF_ID }));
    await ctx.inTenant(() => wardSupplyService.consumeStock(departmentId, itemA.id, 1, { performedBy: STAFF_ID }));

    const byItem = await ctx.inTenant(() => wardSupplyService.listTransactions({ itemId: itemA.id }));
    expect(byItem.meta.total).toBe(2);
    expect(byItem.data.every((t) => t.itemId === itemA.id)).toBe(true);

    const byType = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ departmentId, transactionType: 'Receive' }),
    );
    expect(byType.meta.total).toBe(2);
    expect(byType.data.every((t) => t.transactionType === 'Receive')).toBe(true);

    const page = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ departmentId, limit: 2, page: 2 }),
    );
    expect(page.meta.page).toBe(2);
    expect(page.meta.limit).toBe(2);
    expect(page.meta.total).toBe(3);
    expect(page.data).toHaveLength(1);

    const all = await ctx.inTenant(() => wardSupplyService.listTransactions({ departmentId }));
    expect(all.data[0].performedAt.getTime()).toBeGreaterThanOrEqual(all.data[1].performedAt.getTime());
    expect(all.data[1].performedAt.getTime()).toBeGreaterThanOrEqual(all.data[2].performedAt.getTime());
  });

  it('enforces tenant isolation for balances, batches, and transactions', async () => {
    const tenantB = await ctx.createTenant();
    const departmentId = await makeDepartmentId();
    const item = await makeItem('Oxygen Mask');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 5, { performedBy: STAFF_ID }));

    const tenantBBalances = await tenantB.inTenant(() => wardSupplyService.listBalances({}));
    expect(tenantBBalances.meta.total).toBe(0);

    const tenantBTransactions = await tenantB.inTenant(() => wardSupplyService.listTransactions({}));
    expect(tenantBTransactions.meta.total).toBe(0);

    // No balance row exists in tenant B -> consuming there conflicts.
    await expect(
      tenantB.inTenant(() => wardSupplyService.consumeStock(departmentId, item.id, 1, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);

    // The original tenant is untouched by tenant B's activity.
    const balances = await ctx.inTenant(() => wardSupplyService.listBalances({ departmentId }));
    expect(balances.data[0].availableQuantity).toBe(5);
  });
});
