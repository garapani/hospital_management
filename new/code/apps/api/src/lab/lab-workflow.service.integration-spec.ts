import { BadRequestException } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
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
    ordersService = new OrdersService(ctx.tenantConnection);
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection), new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
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
    async function makeRequisition() {
      requisitionSeq += 1;
      const test = await makeTest(`actor-derivation-${requisitionSeq}`);
      const orderItem = await makeOrderItem(`44500001${String(requisitionSeq).padStart(2, '0')}`);
      const requisition = await ctx.inTenant(() =>
        labWorkflowService.createRequisition({
          orderItemId: orderItem.id,
          testId: test.id,
          specimenType: 'Blood',
        }),
      );
      return { test, orderItem, requisition };
    }

    it('collectSample records the authenticated account as sampleCollectedBy, not the body value', async () => {
      const { requisition } = await makeRequisition();
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const collected = await withActor(() => labWorkflowService.collectSample(requisition.id, spoofed));
      expect(collected.sampleCollectedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('enterResult records the authenticated account as enteredBy on the result row', async () => {
      const { test, requisition } = await makeRequisition();
      await withActor(() => labWorkflowService.collectSample(requisition.id, 'ignored'));
      const component = await ctx.inTenant(() => catalogService.listComponentsByTest(test.id));

      const spoofed = '00000000-0000-0000-0000-0000000000ff';
      const result = await withActor(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component[0].id,
          value: '12.5',
          enteredBy: spoofed,
        }),
      );
      expect(result.enteredBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('verify records the authenticated account as verifiedBy and as the order item completedBy', async () => {
      const { test, orderItem, requisition } = await makeRequisition();
      await withActor(() => labWorkflowService.collectSample(requisition.id, 'ignored'));
      const component = await ctx.inTenant(() => catalogService.listComponentsByTest(test.id));
      await withActor(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component[0].id,
          value: '12.5',
          enteredBy: 'ignored',
        }),
      );

      const spoofed = '00000000-0000-0000-0000-0000000000ff';
      const verified = await withActor(() => labWorkflowService.verify(requisition.id, spoofed));
      expect(verified.verifiedBy).toBe(AUTHENTICATED_ACCOUNT);

      const completedItem = await ctx.inTenant(async () => {
        const order = await ordersService.findOne(orderItem.orderId);
        return order.items.find((i) => i.id === orderItem.id)!;
      });
      expect(completedItem.completedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
