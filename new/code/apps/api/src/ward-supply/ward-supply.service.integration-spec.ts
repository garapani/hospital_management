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
  function makeDepartmentId(): string {
    seq += 1;
    return `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`;
  }

  /** Inserts a catalog item directly — ward-supply validates existence via raw query only. */
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

  it('receives stock into a ward balance (upserting) and records Receive transactions', async () => {
    const departmentId = makeDepartmentId();
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
    expect(balances).toHaveLength(1);
    expect(balances[0].itemId).toBe(item.id);
    expect(balances[0].availableQuantity).toBe(15);

    const transactions = await ctx.inTenant(() =>
      wardSupplyService.listTransactions({ departmentId }),
    );
    expect(transactions.meta.total).toBe(2);
    expect(transactions.data.every((t) => t.transactionType === 'Receive')).toBe(true);
    expect(transactions.data.map((t) => t.quantity).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(transactions.data.every((t) => t.performedBy === STAFF_ID)).toBe(true);
  });

  it('lists balances ordered by itemId across departments', async () => {
    const departmentId = makeDepartmentId();
    const itemA = await makeItem('Amoxicillin');
    const itemB = await makeItem('Insulin');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemB.id, 2, { performedBy: STAFF_ID }));
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, itemA.id, 3, { performedBy: STAFF_ID }));

    const balances = await ctx.inTenant(() => wardSupplyService.listBalances({ departmentId }));
    expect(balances.map((b) => b.itemId)).toEqual([itemA.id, itemB.id].sort());
    expect(balances.map((b) => b.availableQuantity).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('consumes stock, decrementing the balance and recording a Consume transaction', async () => {
    const departmentId = makeDepartmentId();
    const item = await makeItem('Saline');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 10, { performedBy: STAFF_ID }));

    const after = await ctx.inTenant(() =>
      wardSupplyService.consumeStock(departmentId, item.id, 4, {
        patientId: '00000000-0000-0000-0000-0000000000a1',
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
    expect(consume!.patientId).toBe('00000000-0000-0000-0000-0000000000a1');
    expect(consume!.remarks).toBe('Ward usage');
    expect(consume!.performedBy).toBe(STAFF_ID);
  });

  it('rejects consumption beyond available stock with ConflictException', async () => {
    const departmentId = makeDepartmentId();
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
    const departmentId = makeDepartmentId();
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

  it('rejects receiving an unknown inventory item with NotFoundException', async () => {
    const departmentId = makeDepartmentId();
    await expect(
      ctx.inTenant(() =>
        wardSupplyService.receiveStock(departmentId, '00000000-0000-0000-0000-000000000000', 5, {
          performedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('derives performedBy from the authenticated principal, ignoring spoofed values', async () => {
    const departmentId = makeDepartmentId();
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
    const departmentId = makeDepartmentId();
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

  it('enforces tenant isolation for balances and transactions', async () => {
    const tenantB = await ctx.createTenant();
    const departmentId = makeDepartmentId();
    const item = await makeItem('Oxygen Mask');
    await ctx.inTenant(() => wardSupplyService.receiveStock(departmentId, item.id, 5, { performedBy: STAFF_ID }));

    const tenantBBalances = await tenantB.inTenant(() => wardSupplyService.listBalances({}));
    expect(tenantBBalances).toHaveLength(0);

    const tenantBTransactions = await tenantB.inTenant(() => wardSupplyService.listTransactions({}));
    expect(tenantBTransactions.meta.total).toBe(0);

    // No balance row exists in tenant B -> consuming there conflicts.
    await expect(
      tenantB.inTenant(() => wardSupplyService.consumeStock(departmentId, item.id, 1, { performedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);

    // The original tenant is untouched by tenant B's activity.
    const balances = await ctx.inTenant(() => wardSupplyService.listBalances({ departmentId }));
    expect(balances[0].availableQuantity).toBe(5);
  });
});
