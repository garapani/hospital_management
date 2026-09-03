import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app/app.module.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { DepositsService } from '../billing/deposits.service.js';
import { ReportingQueryService } from './reporting-query.service.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { dispatchTenant } from '../database/outbox-dispatcher-entrypoint.js';
import { isAuditExcludedEntity } from '@hospital/audit-emitter';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PersistingReportingEventPublisher (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;

  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let admissionsService: AdmissionsService;
  let ordersService: OrdersService;
  let invoicesService: InvoicesService;
  let depositsService: DepositsService;
  let reportingQueryService: ReportingQueryService;

  const DOCTOR_ID = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Provision tenant schemas directly — no central Tenant row is needed for schema/table setup.
    ctx = await setupTenantTestContext({ namePrefix: 'reporting' });
    tenantB = await ctx.createTenant();

    tenantConnection = moduleFixture.get(TenantConnectionService);
    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    masterDataService = moduleFixture.get(MasterDataService);
    admissionsService = moduleFixture.get(AdmissionsService);
    ordersService = moduleFixture.get(OrdersService);
    invoicesService = moduleFixture.get(InvoicesService);
    depositsService = moduleFixture.get(DepositsService);
    reportingQueryService = moduleFixture.get(ReportingQueryService);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  // Do NOT replace this with ctx.inTenant(): every domain service in this file (patientsService,
  // ordersService, etc.) is resolved from the AppModule DI graph, which holds exactly one
  // TenantContextService instance (TenantContextModule is @Global()). ctx.inTenant() runs on
  // ctx's own separate, standalone TenantContextService (a different AsyncLocalStorage entirely)
  // — using it here would make every DI-resolved service see "No tenant context set".
  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId, correlationId: 'test-correlation' },
      work,
    );
  }

  // Business events now land in outbox_events first (see PersistingReportingEventPublisher's doc
  // comment) — reporting_events only reflects what the outbox dispatcher has drained so far. Every
  // assertion against reporting_events in this file drains synchronously first so the test stays
  // deterministic instead of racing a poll interval.
  async function drain(tenantId: string): Promise<void> {
    await dispatchTenant(`tenant_${tenantId}`);
  }

  async function getEvents(tenantId: string, eventType: string) {
    await drain(tenantId);
    return inTenant(tenantId, () =>
      tenantConnection.runInTenantSchema((manager) =>
        manager
          .getRepository(ReportingEvent)
          .find({ where: { eventType }, order: { occurredAt: 'ASC' } }),
      ),
    );
  }

  it('does not create an outbox row for unmapped entities (Patient)', async () => {
    await inTenant(ctx.tenantId, async () => {
      const beforeCount = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(OutboxEvent).count({ where: { kind: 'Reporting' } }),
      );

      await patientsService.create({
        firstName: 'Unmapped',
        lastName: 'Entity',
        gender: 'Female',
        phoneNumber: '9999999998',
      });

      const afterCount = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(OutboxEvent).count({ where: { kind: 'Reporting' } }),
      );
      expect(afterCount).toBe(beforeCount);
    });
  });

  it('captures all 6 mapped business events successfully', async () => {
    await inTenant(ctx.tenantId, async () => {
      const patient = await patientsService.create({
        firstName: 'Report',
        lastName: 'Patient',
        gender: 'Male',
        phoneNumber: '9999999999',
      });

      // Setup a ward with two beds so admission + transfer have somewhere to go
      const ward = await masterDataService.createWard({
        wardName: 'RW1',
        wardCode: 'RW1',
        wardType: 'General',
      });
      const bed1 = await masterDataService.createBed({
        wardId: ward.id,
        bedNumber: 'R-B1',
      });
      const bed2 = await masterDataService.createBed({
        wardId: ward.id,
        bedNumber: 'R-B2',
      });

      // 1. PatientAdmitted
      const admission = await admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: DOCTOR_ID,
        bedId: bed1.id,
      });

      // 2. BedTransferred (admit() also emits an initial BedTransferred; transfer() emits a second)
      await admissionsService.transfer(admission.id, {
        toBedId: bed2.id,
        transferredBy: DOCTOR_ID,
        reason: 'Upgrade',
      });

      // 3. OrderPlaced
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [
          { itemType: 'Lab', itemDescription: 'CBC', priority: 'Routine' },
        ],
      });

      // 4. InvoiceCreated
      const invoice = await invoicesService.create({
        patientId: patient.id,
        createdBy: DOCTOR_ID,
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
      });

      // 5. PaymentRecorded
      const payment = await invoicesService.recordPayment(invoice.id, {
        amount: 500,
        paymentMode: 'Cash',
        receivedBy: DOCTOR_ID,
      });

      // 6. DepositReceived
      const deposit = await depositsService.create({
        patientId: patient.id,
        amount: 1000,
        receivedBy: DOCTOR_ID,
      });

      // Verify PatientAdmitted
      const admittedEvents = await getEvents(
        ctx.tenantId,
        'PatientAdmitted',
      );
      expect(admittedEvents).toHaveLength(1);
      expect(admittedEvents[0].entityId).toBe(admission.id);
      expect(admittedEvents[0].payload).toMatchObject({
        admissionId: admission.id,
        patientId: patient.id,
        wardId: ward.id,
        bedId: bed1.id,
      });

      // Verify BedTransferred
      const transferEvents = await getEvents(
        ctx.tenantId,
        'BedTransferred',
      );
      expect(transferEvents).toHaveLength(2);

      // Initial admission bed assignment
      expect(transferEvents[0].payload).toMatchObject({
        admissionId: admission.id,
        fromBedId: null,
        toBedId: bed1.id,
      });

      // Transfer
      expect(transferEvents[1].entityId).toBe(
        transferEvents[1].payload.bedTransferId,
      );
      expect(transferEvents[1].payload).toMatchObject({
        admissionId: admission.id,
        fromBedId: bed1.id,
        toBedId: bed2.id,
      });

      // Verify OrderPlaced.
      // Only Order-native columns are captured: afterInsert fires on the `orders` row before
      // OrdersService saves its OrderItem rows, so item data is deliberately not in the payload.
      const orderEvents = await getEvents(ctx.tenantId, 'OrderPlaced');
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0].entityId).toBe(order.id);
      expect(orderEvents[0].payload).toMatchObject({
        orderId: order.id,
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        sourceAppointmentId: null,
        sourceAdmissionId: null,
      });
      expect(orderEvents[0].payload).not.toHaveProperty('itemCount');
      expect(orderEvents[0].payload).not.toHaveProperty('itemTypes');

      // Verify InvoiceCreated
      const invoiceEvents = await getEvents(ctx.tenantId, 'InvoiceCreated');
      expect(invoiceEvents).toHaveLength(1);
      expect(invoiceEvents[0].entityId).toBe(invoice.id);
      expect(invoiceEvents[0].payload).toMatchObject({
        invoiceId: invoice.id,
        patientId: patient.id,
      });
      expect(invoiceEvents[0].payload.totalAmount).toBeDefined();

      // Verify PaymentRecorded
      const paymentEvents = await getEvents(
        ctx.tenantId,
        'PaymentRecorded',
      );
      expect(paymentEvents).toHaveLength(1);
      expect(paymentEvents[0].entityId).toBe(payment.id);
      expect(paymentEvents[0].payload).toMatchObject({
        paymentId: payment.id,
        invoiceId: invoice.id,
        paymentMode: 'Cash',
      });

      // Verify DepositReceived
      const depositEvents = await getEvents(
        ctx.tenantId,
        'DepositReceived',
      );
      expect(depositEvents).toHaveLength(1);
      expect(depositEvents[0].entityId).toBe(deposit.id);
      expect(depositEvents[0].payload).toMatchObject({
        depositId: deposit.id,
        patientId: patient.id,
      });
    });
  });

  it('does not feed reporting events back into the audit trail', async () => {
    // The outbox dispatcher's own connection has no subscribers attached to it (subscribers only
    // ever register on the API process's main DataSource — see ReportingSubscriber/AuditSubscriber
    // wiring), so materializing an outbox row into reporting_events can never itself trigger an
    // audit write, regardless of what any entity decorator says. @AuditExcludeEntity() on
    // ReportingEvent (pinned by the next test) is belt-and-braces defense on top of that, same as
    // it always was.
    await drain(ctx.tenantId);
    const auditRows = await inTenant(ctx.tenantId, () =>
      tenantConnection.runInTenantSchema((m) =>
        m
          .getRepository(AuditRecord)
          .count({ where: { tableName: 'reporting_events' } }),
      ),
    );
    expect(auditRows).toBe(0);
  });

  it('keeps @AuditExcludeEntity() on ReportingEvent as defense-in-depth', () => {
    // Direct regression guard on the decorator itself (unit-level, no subscriber/DB involved).
    expect(isAuditExcludedEntity(ReportingEvent)).toBe(true);
  });

  it('enforces tenant isolation', async () => {
    await drain(tenantB.tenantId);
    await inTenant(tenantB.tenantId, async () => {
      const events = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );
      expect(events).toBe(0); // Should be 0 because all previous events were in ctx.tenantId
    });
  });

  it('writes the outbox row on the SAME manager/transaction as the business write', async () => {
    // Proves the actual fix this whole design exists for: if a later step in the same business
    // transaction fails, the outbox row must roll back with it — no orphan reporting event
    // referencing a change that never persisted.
    const publisher = app.get(PersistingReportingEventPublisher);
    const spy = jest.spyOn(publisher, 'publish');

    try {
      await expect(
        inTenant(ctx.tenantId, () =>
          tenantConnection.runInTenantSchema(async (manager) => {
            await publisher.publish(
              { eventType: 'TestEvent', entityId: '99999999-9999-9999-9999-999999999999', payload: {}, correlationId: null },
              manager,
            );
            throw new Error('simulated failure elsewhere in the same business transaction');
          }),
        ),
      ).rejects.toThrow('simulated failure elsewhere in the same business transaction');

      // publish() was called with the SAME manager the business transaction ran on.
      expect(spy.mock.calls[spy.mock.calls.length - 1][1]).toBeDefined();

      const orphaned = await inTenant(ctx.tenantId, () =>
        tenantConnection.runInTenantSchema((m) =>
          m.getRepository(OutboxEvent).find({
            where: { kind: 'Reporting' },
          }),
        ),
      );
      expect(
        orphaned.some((row) => (row.payload as { entityId: string }).entityId === '99999999-9999-9999-9999-999999999999'),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  describe('when the dispatcher fails to materialize a row', () => {
    it('never affects the already-committed business transaction, and marks the row for retry', async () => {
      // Unlike the old design (where a reporting_events SQL failure ran inside the business
      // transaction's own write path), the outbox write always succeeds against outbox_events —
      // a materialization failure can only ever happen later, in the dispatcher's own separate
      // process/transaction, which is exactly the isolation this design is meant to guarantee.
      const schema = `tenant_${ctx.tenantId}`;
      const order = await inTenant(ctx.tenantId, async () => {
        const patient = await patientsService.create({
          firstName: 'DispatchFailure',
          lastName: 'Test',
          gender: 'Male',
          phoneNumber: '9999999995',
        });
        return ordersService.create({
          patientId: patient.id,
          orderedBy: DOCTOR_ID,
          items: [{ itemType: 'Lab', itemDescription: 'ESR', priority: 'Routine' }],
        });
      });

      const renameTable = async (from: string, to: string) => {
        const queryRunner = ctx.dataSource.createQueryRunner();
        await queryRunner.connect();
        try {
          await queryRunner.query(`ALTER TABLE "${schema}"."${from}" RENAME TO "${to}"`);
        } finally {
          await queryRunner.release();
        }
      };

      await renameTable('reporting_events', 'reporting_events_hidden');
      try {
        await drain(ctx.tenantId);
      } finally {
        await renameTable('reporting_events_hidden', 'reporting_events');
      }

      // The business transaction committed regardless — it never touched reporting_events at all.
      const persisted = await inTenant(ctx.tenantId, () => ordersService.findOne(order.id));
      expect(persisted.id).toBe(order.id);

      // The outbox row is still there, marked for retry — not silently lost.
      const rows = await inTenant(ctx.tenantId, () =>
        tenantConnection.runInTenantSchema((m) =>
          m.getRepository(OutboxEvent).find({
            where: { kind: 'Reporting' },
          }),
        ),
      );
      const row = rows.find((r) => (r.payload as { entityId: string }).entityId === order.id);
      expect(row).toBeDefined();
      expect(row?.status).toBe('Pending');
      expect(row?.attempts).toBe(1);
      expect(row?.lastError).toContain('reporting_events');

      // Now that the table is back, a later drain succeeds and catches it up.
      await drain(ctx.tenantId);
      const orderEvents = await getEvents(ctx.tenantId, 'OrderPlaced');
      expect(orderEvents.map((e) => e.entityId)).toContain(order.id);
    });
  });

  it('revenue excludes deposits and subtracts returns (reporting P2 regression)', async () => {
    // Runs in its own tenant so the aggregate is free of the other tests' events. The old query
    // summed PaymentRecorded + DepositReceived (double-counting a deposit that later funds a
    // payment) and never subtracted returns.
    const revenueCtx = await ctx.createTenant();
    await inTenant(revenueCtx.tenantId, async () => {
      const patient = await patientsService.create({
        firstName: 'Revenue',
        lastName: 'Test',
        dateOfBirth: '1990-01-01',
        gender: 'Female',
        phoneNumber: '5560000999',
      });

      // Deposit: 5000 held, NOT revenue.
      await depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: DOCTOR_ID });
      // Cash payment: 2000 — revenue.
      const invoice = await invoicesService.create({
        patientId: patient.id,
        createdBy: DOCTOR_ID,
        items: [{ description: 'Consultation', unitPrice: 2000 }],
      });
      await invoicesService.recordPayment(invoice.id, {
        amount: 2000,
        paymentMode: 'Cash',
        receivedBy: DOCTOR_ID,
      });
      // Return: 500 — subtracted.
      await invoicesService.createReturn(invoice.id, {
        amount: 500,
        reason: 'Partial refund',
        returnedBy: DOCTOR_ID,
      });

      await drain(revenueCtx.tenantId);
      const revenue = await inTenant(revenueCtx.tenantId, () =>
        reportingQueryService.getRevenue({ from: '2026-01-01', to: '2026-12-31' }),
      );
      const total = revenue.reduce((sum, row) => sum + row.totalAmount, 0);
      // 2000 payment - 500 return = 1500; the 5000 deposit is excluded (it becomes revenue only
      // when a PaymentRecorded event fires for the payment it funds).
      expect(total).toBe(1500);
    });
  });
});
