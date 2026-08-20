import { BadRequestException } from '@nestjs/common';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { FefoStockDecrementService } from './fefo-stock-decrement.service.js';
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InventoryRequisitionService.listByDepartment (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: InventoryCatalogService;
  let masterDataService: MasterDataService;
  let requisitionService: InventoryRequisitionService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'inv_requisition_list' });
    catalogService = new InventoryCatalogService(ctx.tenantConnection);
    masterDataService = new MasterDataService(ctx.tenantConnection);
    requisitionService = new InventoryRequisitionService(
      ctx.tenantConnection,
      new StockRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      masterDataService,
      new FefoStockDecrementService(),
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

  async function makeDepartment(code: string) {
    return ctx.inTenant(() =>
      masterDataService.createDepartment({ departmentCode: code, departmentName: `Dept ${code}` }),
    );
  }

  const REQUESTED_BY = '00000000-0000-0000-0000-0000000000e2';

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

  it('throws BadRequestException when departmentId is omitted', async () => {
    await expect(
      ctx.inTenant(() => requisitionService.listByDepartment({} as any)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => requisitionService.listByDepartment({} as any)),
    ).rejects.toThrow('departmentId is required');
  });

  it('returns only the requested department\'s requisitions, paginated', async () => {
    const item = await makeItem('dept-filter');
    const deptA = await makeDepartment('DEPT-A');
    const deptB = await makeDepartment('DEPT-B');

    await ctx.inTenant(() =>
      requisitionService.createRequisition({
        departmentId: deptA.id,
        requestedBy: REQUESTED_BY,
        items: [{ itemId: item.id, requestedQuantity: 5 }],
      }),
    );
    await ctx.inTenant(() =>
      requisitionService.createRequisition({
        departmentId: deptB.id,
        requestedBy: REQUESTED_BY,
        items: [{ itemId: item.id, requestedQuantity: 5 }],
      }),
    );

    const result = await ctx.inTenant(() =>
      requisitionService.listByDepartment({ departmentId: deptA.id }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].departmentId).toBe(deptA.id);
    expect(result.meta.total).toBe(1);
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

    let requisitionSeq = 0;
    async function makeRequisitionWithStock() {
      requisitionSeq += 1;
      const item = await makeItem(`actor-derivation-${requisitionSeq}`);
      await seedBatch(item.id, `BATCH-ACTOR-${requisitionSeq}`, '2025-06-01', 5);
      const department = await makeDepartment(`DEPT-ACTOR-${requisitionSeq}`);
      const requisition = await ctx.inTenant(() =>
        requisitionService.createRequisition({
          departmentId: department.id,
          requestedBy: REQUESTED_BY,
          items: [{ itemId: item.id, requestedQuantity: 2 }],
        }),
      );
      return requisition;
    }

    it('createRequisition records the authenticated account as requestedBy, not the caller-supplied value', async () => {
      const item = await makeItem('actor-requisition');
      const department = await makeDepartment('DEPT-ACTOR-REQ');
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const requisition = await withActor(() =>
        requisitionService.createRequisition({
          departmentId: department.id,
          requestedBy: spoofed,
          items: [{ itemId: item.id, requestedQuantity: 2 }],
        }),
      );
      expect(requisition.requestedBy).toBe(AUTHENTICATED_ACCOUNT);

      const persisted = await ctx.inTenant(() => requisitionService.findOne(requisition.id));
      expect(persisted.requestedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('fulfillRequisitionItem records the authenticated account as the stock transaction recordedBy, not the caller-supplied value', async () => {
      const requisition = await makeRequisitionWithStock();
      const reqItem = requisition.items[0];
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const fulfilled = await withActor(() =>
        requisitionService.fulfillRequisitionItem(reqItem.id, {
          quantity: 2,
          fulfilledBy: spoofed,
        }),
      );
      expect(Number(fulfilled.fulfilledQuantity)).toBe(2);

      const transaction = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(StockTransaction).findOne({ where: { referenceId: reqItem.id } }),
        ),
      );
      expect(transaction?.recordedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
