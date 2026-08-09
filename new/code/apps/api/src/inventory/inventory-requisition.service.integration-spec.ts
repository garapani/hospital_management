import { BadRequestException } from '@nestjs/common';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
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
});
