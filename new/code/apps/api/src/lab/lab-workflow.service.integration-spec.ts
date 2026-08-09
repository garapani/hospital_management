import { BadRequestException } from '@nestjs/common';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('LabWorkflowService.listByOrderItem (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: LabCatalogService;
  let labWorkflowService: LabWorkflowService;
  let ordersService: OrdersService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'lab_workflow_list' });
    catalogService = new LabCatalogService(ctx.tenantConnection);
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
    );
    ordersService = new OrdersService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection));
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e3';

  async function makeOrderItem(phoneNumber: string) {
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
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      });
      return order.items[0];
    });
  }

  async function makeTest(suffix: string) {
    return ctx.inTenant(async () => {
      const category = await catalogService.createCategory({ name: `Category ${suffix}` });
      const test = await catalogService.createTest({
        categoryId: category.id,
        name: `Test ${suffix}`,
        code: `TEST-${suffix}`,
        specimenType: 'Blood',
      });
      await catalogService.createComponent(test.id, { name: 'Component 1' });
      return test;
    });
  }

  it('throws BadRequestException when orderItemId is omitted', async () => {
    await expect(
      ctx.inTenant(() => labWorkflowService.listByOrderItem({} as any)),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => labWorkflowService.listByOrderItem({} as any)),
    ).rejects.toThrow('orderItemId is required');
  });

  it('returns only the requested order item\'s requisitions, paginated', async () => {
    const test = await makeTest('order-item-filter');
    const orderItemA = await makeOrderItem('4450000001');
    const orderItemB = await makeOrderItem('4450000002');

    await ctx.inTenant(() =>
      labWorkflowService.createRequisition({
        orderItemId: orderItemA.id,
        testId: test.id,
        specimenType: 'Blood',
      }),
    );
    await ctx.inTenant(() =>
      labWorkflowService.createRequisition({
        orderItemId: orderItemB.id,
        testId: test.id,
        specimenType: 'Blood',
      }),
    );

    const result = await ctx.inTenant(() =>
      labWorkflowService.listByOrderItem({ orderItemId: orderItemA.id }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].orderItemId).toBe(orderItemA.id);
    expect(result.meta.total).toBe(1);
  });
});
