import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import { DataSource, ObjectLiteral, Repository } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { DepositsService } from '../billing/deposits.service.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { isAuditExcludedEntity } from '@hospital/audit-emitter';
import {
  REPORTING_DATA_SOURCE,
  createReportingDataSource,
} from '../database/reporting-data-source.js';

describe('PersistingReportingEventPublisher (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let accountsService: AccountsService;

  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let admissionsService: AdmissionsService;
  let ordersService: OrdersService;
  let invoicesService: InvoicesService;
  let depositsService: DepositsService;

  const TEST_TENANT_ID_1 = `test_reporting_${Date.now()}`;
  const TEST_TENANT_ID_2 = `test_reporting_iso_${Date.now()}`;
  const DOCTOR_ID = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = globalDataSource;
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    accountsService = moduleFixture.get(AccountsService);
    tenantConnection = moduleFixture.get(TenantConnectionService);
    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    masterDataService = moduleFixture.get(MasterDataService);
    admissionsService = moduleFixture.get(AdmissionsService);
    ordersService = moduleFixture.get(OrdersService);
    invoicesService = moduleFixture.get(InvoicesService);
    depositsService = moduleFixture.get(DepositsService);

    // Provision tenant schemas directly — no central Tenant row is needed for schema/table setup.
    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID_1);
    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID_2);
  });

  afterAll(async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(
        `DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID_1}" CASCADE`,
      );
      await queryRunner.query(
        `DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID_2}" CASCADE`,
      );
    } finally {
      await queryRunner.release();
    }
    await app.close();
  });

  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId, correlationId: 'test-correlation' },
      work,
    );
  }

  async function getEvents(tenantId: string, eventType: string) {
    return inTenant(tenantId, () =>
      tenantConnection.runInTenantSchema((manager) =>
        manager
          .getRepository(ReportingEvent)
          .find({ where: { eventType }, order: { occurredAt: 'ASC' } }),
      ),
    );
  }

  it('does not create a reporting event for unmapped entities (Patient)', async () => {
    await inTenant(TEST_TENANT_ID_1, async () => {
      const beforeCount = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );

      await patientsService.create({
        firstName: 'Unmapped',
        lastName: 'Entity',
        gender: 'Female',
        phoneNumber: '9999999998',
      });

      const afterCount = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );
      expect(afterCount).toBe(beforeCount);
    });
  });

  it('captures all 6 mapped business events successfully', async () => {
    await inTenant(TEST_TENANT_ID_1, async () => {
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
        TEST_TENANT_ID_1,
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
        TEST_TENANT_ID_1,
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
      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
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
      const invoiceEvents = await getEvents(TEST_TENANT_ID_1, 'InvoiceCreated');
      expect(invoiceEvents).toHaveLength(1);
      expect(invoiceEvents[0].entityId).toBe(invoice.id);
      expect(invoiceEvents[0].payload).toMatchObject({
        invoiceId: invoice.id,
        patientId: patient.id,
      });
      expect(invoiceEvents[0].payload.totalAmount).toBeDefined();

      // Verify PaymentRecorded
      const paymentEvents = await getEvents(
        TEST_TENANT_ID_1,
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
        TEST_TENANT_ID_1,
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
    // NOTE on why this passes: it is NOT currently because of @AuditExcludeEntity() on
    // ReportingEvent. Reporting writes run through `REPORTING_DATA_SOURCE` (see
    // persisting-reporting-event-publisher.ts), a separate TypeORM `DataSource` from the main one.
    // Both `ReportingSubscriber` (reporting.subscriber.ts) and `AuditSubscriber`
    // (audit-wiring.service.ts) register themselves only on the main, injected `DataSource`'s
    // `subscribers` array — never on `REPORTING_DATA_SOURCE`. So no subscriber, audit or
    // otherwise, is even attached to the connection a reporting write runs on; the audit
    // subscriber has no opportunity to fire regardless of what any entity decorator says.
    // @AuditExcludeEntity() on ReportingEvent is therefore redundant belt-and-braces defense today,
    // not the active mechanism keeping this test green — see the decorator-presence guard below
    // for a direct regression check on the decorator itself.
    const auditRows = await inTenant(TEST_TENANT_ID_1, () =>
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
    // The test above proves reporting writes never reach audit_records today because of pool
    // separation, not this decorator — but if a future refactor ever routes reporting writes back
    // through the main DataSource (or a subscriber gets attached to REPORTING_DATA_SOURCE), this
    // decorator becomes the only thing standing between that write and a duplicated audit_records
    // row. This pins that it's still present.
    expect(isAuditExcludedEntity(ReportingEvent)).toBe(true);
  });

  it('enforces tenant isolation', async () => {
    await inTenant(TEST_TENANT_ID_2, async () => {
      const events = await tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).count(),
      );
      expect(events).toBe(0); // Should be 0 because all previous events were in TEST_TENANT_ID_1
    });
  });

  it('writes reporting events on a dedicated, bounded connection pool', () => {
    // Reporting writes take a *second* connection while the business transaction still holds its
    // own. If both came from the same pool, N concurrent tracked writes at pool capacity would
    // block forever (node-postgres defaults to connectionTimeoutMillis: 0 = wait indefinitely).
    // What bounds that: a pool object distinct from the main one, capped, with a finite
    // acquisition timeout so exhaustion throws (and is caught + logged by the publisher).
    const reportingDataSource = app.get<DataSource>(REPORTING_DATA_SOURCE);
    const mainDataSource = app.get(DataSource);

    expect(reportingDataSource).not.toBe(mainDataSource);
    expect(reportingDataSource.isInitialized).toBe(true);
    expect(reportingDataSource.options.extra).toMatchObject({
      max: 3,
      connectionTimeoutMillis: 2000,
    });
    // This pool never runs migrations and maps only the reporting entity.
    expect(reportingDataSource.options.migrations).toEqual([]);
    expect(reportingDataSource.options.entities).toEqual([ReportingEvent]);
  });

  it('routes reporting writes through REPORTING_DATA_SOURCE, not the main pool', async () => {
    // Pins the second argument to `runInTenantSchema` in
    // persisting-reporting-event-publisher.ts (`this.tenantConnectionService.runInTenantSchema(
    // work, this.reportingDataSource)`). Every other test in this file exercises the publisher
    // without inspecting which pool actually served the write, so silently dropping that second
    // argument — reverting reporting writes to the shared main pool and reintroducing the
    // pool-exhaustion deadlock this whole fix chain exists to prevent — would leave every existing
    // test green. This is a real spy on the live TenantConnectionService instance (not a mock
    // replacement), so the underlying reporting write still executes for real.
    const reportingDataSource = app.get<DataSource>(REPORTING_DATA_SOURCE);
    const spy = jest.spyOn(tenantConnection, 'runInTenantSchema');

    try {
      await inTenant(TEST_TENANT_ID_1, async () => {
        const patient = await patientsService.create({
          firstName: 'Routing',
          lastName: 'Pin',
          gender: 'Male',
          phoneNumber: '9999999993',
        });
        await ordersService.create({
          patientId: patient.id,
          orderedBy: DOCTOR_ID,
          items: [
            { itemType: 'Lab', itemDescription: 'Routing', priority: 'Routine' },
          ],
        });
      });

      expect(
        spy.mock.calls.some(([, dataSourceArg]) => dataSourceArg === reportingDataSource),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('fails fast instead of hanging when the reporting pool is exhausted', async () => {
    // Proves the *mechanism* the config above relies on: with a bounded `max` and a finite
    // `connectionTimeoutMillis`, an over-capacity acquisition rejects rather than waiting forever.
    // Run against a throwaway 1-connection / 200ms clone so the assertion is deterministic and
    // costs a fraction of a second — the real pool's 3/5000s values are asserted separately above.
    const tinyPool = new DataSource({
      ...createReportingDataSource().options,
      extra: { max: 1, connectionTimeoutMillis: 200 },
    } as DataSourceOptions);
    await tinyPool.initialize();

    const held = tinyPool.createQueryRunner();
    await held.connect(); // occupies the pool's only connection
    try {
      const starved = tinyPool.createQueryRunner();
      const startedAt = Date.now();
      await expect(starved.connect()).rejects.toThrow(/timeout/i);
      expect(Date.now() - startedAt).toBeLessThan(3000);
    } finally {
      await held.release();
      await tinyPool.destroy();
    }
  });

  // Global Constraint: "Failed reporting-archive write must never roll back or block the
  // real business transaction." The first test is the definitive one — a genuine Postgres error
  // on the reporting_events INSERT. The remaining two simulate failure above the SQL layer and
  // pin the JS-level try/catch structure in the publisher and the subscriber respectively.
  describe('when the reporting-archive write fails', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('still commits the business insert when the reporting_events INSERT fails at the SQL level', async () => {
      // Real SQL failure, not a JS mock: the reporting_events table is renamed out from under
      // the publisher, so its INSERT raises Postgres 42P01 (undefined_table).
      //
      // This is the test that was impossible before the write moved off the business
      // transaction's QueryRunner. Previously the publisher's save ran on the SAME connection as
      // the `orders` INSERT, so a 42P01 aborted that transaction — Postgres then rejects every
      // subsequent statement including COMMIT ("current transaction is aborted"), and the order
      // would never have persisted no matter what the publisher's try/catch did. The order being
      // readable afterwards is therefore proof the reporting write is on its own connection.
      const schema = `tenant_${TEST_TENANT_ID_1}`;
      const loggedErrors: unknown[] = [];
      jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((message: unknown) => {
          loggedErrors.push(message);
        });

      const renameTable = async (from: string, to: string) => {
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.connect();
        try {
          await queryRunner.query(
            `ALTER TABLE "${schema}"."${from}" RENAME TO "${to}"`,
          );
        } finally {
          await queryRunner.release();
        }
      };

      await renameTable('reporting_events', 'reporting_events_hidden');

      let order: { id: string };
      let patientId: string;
      try {
        const result = await inTenant(TEST_TENANT_ID_1, async () => {
          const patient = await patientsService.create({
            firstName: 'SqlLevel',
            lastName: 'Failure',
            gender: 'Male',
            phoneNumber: '9999999995',
          });
          const created = await ordersService.create({
            patientId: patient.id,
            orderedBy: DOCTOR_ID,
            items: [
              { itemType: 'Lab', itemDescription: 'ESR', priority: 'Routine' },
            ],
          });
          return { order: created, patientId: patient.id };
        });
        order = result.order;
        patientId = result.patientId;
      } finally {
        await renameTable('reporting_events_hidden', 'reporting_events');
      }

      jest.restoreAllMocks();

      // The reporting write really did blow up at the SQL layer — a vacuous pass (e.g. the
      // subscriber never firing) would leave nothing logged. The assertion also pins the actual
      // Postgres undefined_table text, so an unrelated failure that shares the same log prefix
      // (e.g. "No tenant context set") cannot satisfy it.
      expect(
        loggedErrors.some(
          (message) =>
            typeof message === 'string' &&
            message.includes('Failed to persist reporting event OrderPlaced') &&
            /reporting_events.*does not exist/i.test(message),
        ),
      ).toBe(true);

      // ...and the business transaction still committed: order + items are readable.
      const persisted = await inTenant(TEST_TENANT_ID_1, () =>
        ordersService.findOne(order.id),
      );
      expect(persisted.id).toBe(order.id);
      expect(persisted.patientId).toBe(patientId);
      expect(persisted.items).toHaveLength(1);

      // No reporting event was archived for it.
      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
      expect(orderEvents.map((e) => e.entityId)).not.toContain(order.id);
    });

    it('still commits the business insert when the reporting_events save throws', async () => {
      const realSave = Repository.prototype.save;
      jest.spyOn(Repository.prototype, 'save').mockImplementation(function (
        this: Repository<ObjectLiteral>,
        ...args: unknown[]
      ) {
        if (this.target === ReportingEvent) {
          return Promise.reject(
            new Error('simulated reporting_events write failure'),
          );
        }
        return (realSave as (...a: unknown[]) => Promise<unknown>).apply(
          this,
          args,
        );
      } as typeof Repository.prototype.save);

      const { order, patientId } = await inTenant(
        TEST_TENANT_ID_1,
        async () => {
          const patient = await patientsService.create({
            firstName: 'Archive',
            lastName: 'Failure',
            gender: 'Male',
            phoneNumber: '9999999997',
          });
          const created = await ordersService.create({
            patientId: patient.id,
            orderedBy: DOCTOR_ID,
            items: [
              { itemType: 'Lab', itemDescription: 'LFT', priority: 'Routine' },
            ],
          });
          return { order: created, patientId: patient.id };
        },
      );

      jest.restoreAllMocks();

      // The business transaction committed: the order and its items are readable.
      const persisted = await inTenant(TEST_TENANT_ID_1, () =>
        ordersService.findOne(order.id),
      );
      expect(persisted.id).toBe(order.id);
      expect(persisted.patientId).toBe(patientId);
      expect(persisted.items).toHaveLength(1);

      // ...and no reporting event was archived for it.
      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
      expect(orderEvents.map((e) => e.entityId)).not.toContain(order.id);
    });

    it('still commits the business insert when the publisher itself rejects', async () => {
      const publisher = app.get(PersistingReportingEventPublisher);
      jest
        .spyOn(publisher, 'publish')
        .mockRejectedValue(new Error('simulated reporting publisher failure'));

      const order = await inTenant(TEST_TENANT_ID_1, async () => {
        const patient = await patientsService.create({
          firstName: 'Publisher',
          lastName: 'Failure',
          gender: 'Female',
          phoneNumber: '9999999996',
        });
        return ordersService.create({
          patientId: patient.id,
          orderedBy: DOCTOR_ID,
          items: [
            {
              itemType: 'Radiology',
              itemDescription: 'X-Ray',
              priority: 'Routine',
            },
          ],
        });
      });

      jest.restoreAllMocks();

      const persisted = await inTenant(TEST_TENANT_ID_1, () =>
        ordersService.findOne(order.id),
      );
      expect(persisted.id).toBe(order.id);

      const orderEvents = await getEvents(TEST_TENANT_ID_1, 'OrderPlaced');
      expect(orderEvents.map((e) => e.entityId)).not.toContain(order.id);
    });
  });
});
