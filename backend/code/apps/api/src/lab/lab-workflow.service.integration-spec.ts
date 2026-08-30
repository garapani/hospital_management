import { ConflictException } from '@nestjs/common';
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
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection), new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      patientsService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e3';

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

  it('serves as a status-filtered worklist across order items when orderItemId is omitted', async () => {
    // Regression test for code-review-findings-2026-08-25's lab P2: there was previously no way
    // to find a requisition without already knowing its order item id, so a technician had no
    // worklist. orderItemId is now optional; status becomes the worklist filter.
    const test = await makeTest('worklist');
    const orderItemPending = await makeOrderItem('4450000097');
    const orderItemCollected = await makeOrderItem('4450000096');

    const pendingReq = await ctx.inTenant(() =>
      labWorkflowService.createRequisition({ orderItemId: orderItemPending.id, testId: test.id, specimenType: 'Blood' }),
    );
    const collectedReq = await ctx.inTenant(() =>
      labWorkflowService.createRequisition({ orderItemId: orderItemCollected.id, testId: test.id, specimenType: 'Blood' }),
    );
    await ctx.inTenant(() => labWorkflowService.collectSample(collectedReq.id, '00000000-0000-4000-8000-0000000000e5'));

    const pendingWorklist = await ctx.inTenant(() =>
      labWorkflowService.listByOrderItem({ status: 'Pending' } as any),
    );
    const pendingIds = pendingWorklist.data.map((r) => r.id);
    expect(pendingIds).toContain(pendingReq.id);
    expect(pendingIds).not.toContain(collectedReq.id);

    const collectedWorklist = await ctx.inTenant(() =>
      labWorkflowService.listByOrderItem({ status: 'SampleCollected' } as any),
    );
    const collectedIds = collectedWorklist.data.map((r) => r.id);
    expect(collectedIds).toContain(collectedReq.id);
    expect(collectedIds).not.toContain(pendingReq.id);
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

  it('listResultsByRequisition returns the entered results for a requisition (frontend review 2026-08-30: verification was previously blind — no read path for entered values existed)', async () => {
    const test = await makeTest('list-results');
    const component = await ctx.inTenant(() => catalogService.listComponentsByTest(test.id));
    const orderItem = await makeOrderItem('4450000098');
    const requisition = await ctx.inTenant(() =>
      labWorkflowService.createRequisition({ orderItemId: orderItem.id, testId: test.id, specimenType: 'Blood' }),
    );
    await ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5'));
    await ctx.inTenant(() =>
      labWorkflowService.enterResult(requisition.id, {
        componentId: component[0].id,
        value: '4.5',
        enteredBy: '00000000-0000-4000-8000-0000000000e5',
      }),
    );

    const results = await ctx.inTenant(() => labWorkflowService.listResultsByRequisition(requisition.id));

    expect(results).toHaveLength(1);
    expect(results[0].componentId).toBe(component[0].id);
    expect(results[0].value).toBe('4.5');
  });

  it('listResultsByRequisition 404s for a non-existent requisition', async () => {
    await expect(
      ctx.inTenant(() => labWorkflowService.listResultsByRequisition('00000000-0000-4000-8000-000000000abc')),
    ).rejects.toThrow('not found');
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
      const spoofed = '00000000-0000-4000-8000-0000000000ff';

      const collected = await withActor(() => labWorkflowService.collectSample(requisition.id, spoofed));
      expect(collected.sampleCollectedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('enterResult records the authenticated account as enteredBy on the result row', async () => {
      const { test, requisition } = await makeRequisition();
      await withActor(() => labWorkflowService.collectSample(requisition.id, 'ignored'));
      const component = await ctx.inTenant(() => catalogService.listComponentsByTest(test.id));

      const spoofed = '00000000-0000-4000-8000-0000000000ff';
      const result = await withActor(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component[0].id,
          value: '12.5',
          enteredBy: spoofed,
        }),
      );
      expect(result.enteredBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('re-entering a result for the same component overwrites the value in place (one row)', async () => {
      const { test, requisition } = await makeRequisition();
      await withActor(() => labWorkflowService.collectSample(requisition.id, 'ignored'));
      const component = await ctx.inTenant(() => catalogService.listComponentsByTest(test.id));

      const first = await withActor(() =>
        labWorkflowService.enterResult(requisition.id, { componentId: component[0].id, value: '12.5' }),
      );
      const second = await withActor(() =>
        labWorkflowService.enterResult(requisition.id, { componentId: component[0].id, value: '13.1', isAbnormal: true }),
      );

      expect(second.id).toBe(first.id);
      expect(second.value).toBe('13.1');
      expect(second.isAbnormal).toBe(true);
      expect(second.enteredAt.getTime()).toBeGreaterThanOrEqual(first.enteredAt.getTime());
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

      const spoofed = '00000000-0000-4000-8000-0000000000ff';
      const verified = await withActor(() => labWorkflowService.verify(requisition.id, spoofed));
      expect(verified.verifiedBy).toBe(AUTHENTICATED_ACCOUNT);

      const completedItem = await ctx.inTenant(async () => {
        const order = await ordersService.findOne(orderItem.orderId);
        return order.items.find((i) => i.id === orderItem.id)!;
      });
      expect(completedItem.completedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });

  describe('reference range evaluation (code-review-findings-2026-08-25 lab P2)', () => {
    async function makeRangedTest(suffix: string) {
      return ctx.inTenant(async () => {
        const category = await catalogService.createCategory({ name: `Ranged Category ${suffix}` });
        const test = await catalogService.createTest({
          categoryId: category.id,
          name: `Ranged Test ${suffix}`,
          code: `RANGED-${suffix}`,
          specimenType: 'Blood',
        });
        const component = await catalogService.createComponent(test.id, {
          name: 'Ranged Component',
          referenceRangeLow: 4.0,
          referenceRangeHigh: 11.0,
        });
        return { test, component };
      });
    }

    it('computes isAbnormal from the numeric reference range, overriding operator input', async () => {
      const { test, component } = await makeRangedTest('override');
      const orderItem = await makeOrderItem('4450000095');
      const requisition = await ctx.inTenant(() =>
        labWorkflowService.createRequisition({ orderItemId: orderItem.id, testId: test.id, specimenType: 'Blood' }),
      );
      await ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5'));

      // In range, but operator explicitly (and wrongly) flags it abnormal — the range must win.
      const inRange = await ctx.inTenant(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component.id,
          value: '7.0',
          isAbnormal: true,
          enteredBy: '00000000-0000-4000-8000-0000000000e5',
        }),
      );
      expect(inRange.isAbnormal).toBe(false);

      // Out of range, operator says nothing — the range must still flag it.
      const outOfRange = await ctx.inTenant(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component.id,
          value: '15.0',
          enteredBy: '00000000-0000-4000-8000-0000000000e5',
        }),
      );
      expect(outOfRange.isAbnormal).toBe(true);
    });

    it('falls back to operator input for a non-numeric value against a numeric-range component', async () => {
      const { test, component } = await makeRangedTest('non-numeric');
      const orderItem = await makeOrderItem('4450000094');
      const requisition = await ctx.inTenant(() =>
        labWorkflowService.createRequisition({ orderItemId: orderItem.id, testId: test.id, specimenType: 'Blood' }),
      );
      await ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5'));

      const result = await ctx.inTenant(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component.id,
          value: 'Hemolyzed',
          isAbnormal: true,
          enteredBy: '00000000-0000-4000-8000-0000000000e5',
        }),
      );
      expect(result.isAbnormal).toBe(true);
    });
  });

  describe('status machine guards (code-review-findings-2026-08-25 lab P2)', () => {
    // Previously untested: out-of-order transitions, and edits attempted after a requisition
    // reaches a terminal state (Verified/Cancelled) — a patient-safety-critical gap for a module
    // whose whole point is locking down results once verified.
    let seq = 0;
    async function makePendingRequisition() {
      seq += 1;
      const test = await makeTest(`status-machine-${seq}`);
      const orderItem = await makeOrderItem(`44500009${String(seq).padStart(2, '0')}`);
      const requisition = await ctx.inTenant(() =>
        labWorkflowService.createRequisition({ orderItemId: orderItem.id, testId: test.id, specimenType: 'Blood' }),
      );
      const component = (await ctx.inTenant(() => catalogService.listComponentsByTest(test.id)))[0];
      return { test, orderItem, requisition, component };
    }

    it('rejects enterResult on a Pending requisition (no sample collected yet)', async () => {
      const { requisition, component } = await makePendingRequisition();
      await expect(
        ctx.inTenant(() => labWorkflowService.enterResult(requisition.id, { componentId: component.id, value: '1' })),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects verify on a Pending requisition (no sample collected yet)', async () => {
      const { requisition } = await makePendingRequisition();
      await expect(ctx.inTenant(() => labWorkflowService.verify(requisition.id))).rejects.toThrow(ConflictException);
    });

    it('rejects collectSample a second time (already SampleCollected)', async () => {
      const { requisition } = await makePendingRequisition();
      await ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5'));
      await expect(
        ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5')),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects verify while a component still has no entered result', async () => {
      const { requisition } = await makePendingRequisition();
      await ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5'));
      await expect(ctx.inTenant(() => labWorkflowService.verify(requisition.id))).rejects.toThrow(ConflictException);
    });

    it('rejects enterResult, verify, and cancel on an already-Verified requisition', async () => {
      const { requisition, component } = await makePendingRequisition();
      await ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5'));
      await ctx.inTenant(() =>
        labWorkflowService.enterResult(requisition.id, {
          componentId: component.id,
          value: '1',
          enteredBy: '00000000-0000-4000-8000-0000000000e5',
        }),
      );
      await ctx.inTenant(() => labWorkflowService.verify(requisition.id, '00000000-0000-4000-8000-0000000000e5'));

      await expect(
        ctx.inTenant(() => labWorkflowService.enterResult(requisition.id, { componentId: component.id, value: '2' })),
      ).rejects.toThrow(ConflictException);
      await expect(ctx.inTenant(() => labWorkflowService.verify(requisition.id))).rejects.toThrow(ConflictException);
      await expect(ctx.inTenant(() => labWorkflowService.cancel(requisition.id))).rejects.toThrow(ConflictException);
    });

    it('rejects enterResult, collectSample, and verify on a Cancelled requisition', async () => {
      const { requisition, component } = await makePendingRequisition();
      await ctx.inTenant(() => labWorkflowService.cancel(requisition.id, 'Ordered in error'));

      await expect(
        ctx.inTenant(() => labWorkflowService.collectSample(requisition.id, '00000000-0000-4000-8000-0000000000e5')),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() => labWorkflowService.enterResult(requisition.id, { componentId: component.id, value: '1' })),
      ).rejects.toThrow(ConflictException);
      await expect(ctx.inTenant(() => labWorkflowService.verify(requisition.id))).rejects.toThrow(ConflictException);
    });
  });
});
