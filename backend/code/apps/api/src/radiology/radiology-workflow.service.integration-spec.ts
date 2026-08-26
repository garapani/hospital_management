import { BadRequestException, ConflictException } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('RadiologyWorkflowService (integration)', () => {
  let ctx: TenantTestContext;
  let catalogService: RadiologyCatalogService;
  let ordersService: OrdersService;
  let workflowService: RadiologyWorkflowService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'radiology_workflow' });
    catalogService = new RadiologyCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    workflowService = new RadiologyWorkflowService(
      ctx.tenantConnection,
      new RadiologyRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e4';
  const TECH_ID = '00000000-0000-0000-0000-0000000000e6';
  const RADIOLOGIST_ID = '00000000-0000-0000-0000-0000000000e7';

  async function makeOrderItem(phoneNumber: string, itemType = 'Radiology') {
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
        items: [{ itemType, itemDescription: 'Chest X-Ray' }],
      });
      return order.items[0];
    });
  }

  async function makeImagingItem(suffix: string) {
    return ctx.inTenant(async () => {
      const type = await catalogService.createType({ name: `Type ${suffix}` });
      return catalogService.createItem({ imagingTypeId: type.id, name: `Item ${suffix}` });
    });
  }

  describe('createRequisition', () => {
    it('creates a requisition for a valid Radiology order item', async () => {
      const item = await makeImagingItem('create');
      const orderItem = await makeOrderItem('4460000001');

      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );

      expect(requisition.status).toBe('Pending');
      expect(requisition.orderItemId).toBe(orderItem.id);
    });

    it('rejects an order item that is not a Radiology order', async () => {
      const item = await makeImagingItem('wrong-type');
      const orderItem = await makeOrderItem('4460000002', 'Lab');

      await expect(
        ctx.inTenant(() =>
          workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate non-cancelled requisition for the same order item', async () => {
      const item = await makeImagingItem('duplicate');
      const orderItem = await makeOrderItem('4460000003');

      await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );

      await expect(
        ctx.inTenant(() =>
          workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('status machine', () => {
    it('walks Pending -> Scanned -> ReportEntered -> Verified, completing the order item', async () => {
      const item = await makeImagingItem('walk');
      const orderItem = await makeOrderItem('4460000004');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );

      const scanned = await ctx.inTenant(() => workflowService.markScanned(requisition.id, TECH_ID));
      expect(scanned.status).toBe('Scanned');

      const reported = await ctx.inTenant(() =>
        workflowService.enterReport(requisition.id, { reportText: 'Normal study', reportEnteredBy: TECH_ID }),
      );
      expect(reported.status).toBe('ReportEntered');

      const verified = await ctx.inTenant(() => workflowService.verify(requisition.id, RADIOLOGIST_ID));
      expect(verified.status).toBe('Verified');

      // Confirms the OrdersService.completeItemInTransaction routing (not a raw repository
      // mutation) actually lands: the order item should be Completed after verify().
      const completedOrder = await ctx.inTenant(() => ordersService.findOne(orderItem.orderId));
      const completedItem = completedOrder.items.find((i) => i.id === orderItem.id);
      expect(completedItem?.status).toBe('Completed');
      expect(completedItem?.completedBy).toBe(RADIOLOGIST_ID);
    });

    it('rejects markScanned when the requisition is not Pending', async () => {
      const item = await makeImagingItem('scan-guard');
      const orderItem = await makeOrderItem('4460000005');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );
      await ctx.inTenant(() => workflowService.markScanned(requisition.id, TECH_ID));

      await expect(
        ctx.inTenant(() => workflowService.markScanned(requisition.id, TECH_ID)),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects enterReport with a blank reportText', async () => {
      const item = await makeImagingItem('report-guard');
      const orderItem = await makeOrderItem('4460000006');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );
      await ctx.inTenant(() => workflowService.markScanned(requisition.id, TECH_ID));

      await expect(
        ctx.inTenant(() =>
          workflowService.enterReport(requisition.id, { reportText: '', reportEnteredBy: TECH_ID }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects verify before a report has been entered', async () => {
      const item = await makeImagingItem('verify-guard');
      const orderItem = await makeOrderItem('4460000007');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );

      await expect(
        ctx.inTenant(() => workflowService.verify(requisition.id, RADIOLOGIST_ID)),
      ).rejects.toThrow(ConflictException);
    });

    it('verify does not resurrect an order item that was independently cancelled', async () => {
      // Regression test for code-review-findings-2026-08-25's radiology P2 (same root cause as
      // the orders P1: `completeItemInTransaction` used to resurrect any non-Completed order item,
      // including a Cancelled one, to Completed). Cancels the order item directly via
      // OrdersService — bypassing the order-cancellation-cascade subscriber, which isn't wired up
      // in this spec's standalone service construction — so the requisition itself stays
      // ReportEntered and verify() genuinely reaches completeItemInTransaction with a Cancelled
      // order item underneath it, exactly reproducing the original race.
      const item = await makeImagingItem('verify-vs-cancelled-item');
      const orderItem = await makeOrderItem('4460000098');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );
      await ctx.inTenant(() => workflowService.markScanned(requisition.id, TECH_ID));
      await ctx.inTenant(() =>
        workflowService.enterReport(requisition.id, { reportText: 'Normal study', reportEnteredBy: TECH_ID }),
      );

      await ctx.inTenant(() => ordersService.cancelItem(orderItem.orderId, orderItem.id, {}));

      const verified = await ctx.inTenant(() => workflowService.verify(requisition.id, RADIOLOGIST_ID));
      expect(verified.status).toBe('Verified');

      const order = await ctx.inTenant(() => ordersService.findOne(orderItem.orderId));
      const item2 = order.items.find((i) => i.id === orderItem.id);
      expect(item2?.status).toBe('Cancelled');
      expect(item2?.completedAt).toBeNull();
    });
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
      const item = await makeImagingItem(`actor-derivation-${requisitionSeq}`);
      const orderItem = await makeOrderItem(`44610000${String(requisitionSeq).padStart(2, '0')}`);
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );
      return { item, orderItem, requisition };
    }

    it('markScanned records the authenticated account as scannedBy, not the body value', async () => {
      const { requisition } = await makeRequisition();
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const scanned = await withActor(() => workflowService.markScanned(requisition.id, spoofed));
      expect(scanned.scannedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('enterReport records the authenticated account as reportEnteredBy, not the body value', async () => {
      const { requisition } = await makeRequisition();
      await withActor(() => workflowService.markScanned(requisition.id, 'ignored'));

      const spoofed = '00000000-0000-0000-0000-0000000000ff';
      const reported = await withActor(() =>
        workflowService.enterReport(requisition.id, {
          reportText: 'Normal study',
          reportEnteredBy: spoofed,
        }),
      );
      expect(reported.reportEnteredBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('verify records the authenticated account as verifiedBy and as the order item completedBy', async () => {
      const { orderItem, requisition } = await makeRequisition();
      await withActor(() => workflowService.markScanned(requisition.id, 'ignored'));
      await withActor(() =>
        workflowService.enterReport(requisition.id, {
          reportText: 'Normal study',
          reportEnteredBy: 'ignored',
        }),
      );

      const spoofed = '00000000-0000-0000-0000-0000000000ff';
      const verified = await withActor(() => workflowService.verify(requisition.id, spoofed));
      expect(verified.verifiedBy).toBe(AUTHENTICATED_ACCOUNT);

      const completedItem = await ctx.inTenant(async () => {
        const order = await ordersService.findOne(orderItem.orderId);
        return order.items.find((i) => i.id === orderItem.id)!;
      });
      expect(completedItem.completedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });

  describe('cancel', () => {
    it('cancels a Pending requisition', async () => {
      const item = await makeImagingItem('cancel');
      const orderItem = await makeOrderItem('4460000008');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );

      const cancelled = await ctx.inTenant(() => workflowService.cancel(requisition.id, 'Patient no-show'));

      expect(cancelled.status).toBe('Cancelled');
      expect(cancelled.cancelReason).toBe('Patient no-show');
    });

    it('rejects cancelling an already-Verified requisition', async () => {
      const item = await makeImagingItem('cancel-guard');
      const orderItem = await makeOrderItem('4460000009');
      const requisition = await ctx.inTenant(() =>
        workflowService.createRequisition({ orderItemId: orderItem.id, imagingItemId: item.id }),
      );
      await ctx.inTenant(() => workflowService.markScanned(requisition.id, TECH_ID));
      await ctx.inTenant(() =>
        workflowService.enterReport(requisition.id, { reportText: 'Normal', reportEnteredBy: TECH_ID }),
      );
      await ctx.inTenant(() => workflowService.verify(requisition.id, RADIOLOGIST_ID));

      await expect(ctx.inTenant(() => workflowService.cancel(requisition.id))).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
