import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PatientsService } from '../patients/patients.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { FractionService } from './fraction.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { FractionEntry } from './entities/fraction.entity.js';

/**
 * FractionReversalSubscriber end-to-end: booting the real AppModule DI graph rather than
 * instantiating the subscriber by hand — subscribers self-register onto the shared DataSource
 * (fraction-reversal.subscriber.ts), so the only way to exercise the real wiring is through the
 * same DataSource the domain services use (same pattern as the notifications subscriber spec).
 */
describe('FractionReversalSubscriber (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;
  let fractionService: FractionService;
  let accountsService: AccountsService;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ctx = await setupTenantTestContext({ namePrefix: 'fraction_sub' });

    tenantConnection = moduleFixture.get(TenantConnectionService);
    tenantContextService = moduleFixture.get(TenantContextService);
    patientsService = moduleFixture.get(PatientsService);
    invoicesService = moduleFixture.get(InvoicesService);
    fractionService = moduleFixture.get(FractionService);
    accountsService = moduleFixture.get(AccountsService);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  // Do NOT replace with ctx.inTenant(): every service here is resolved from the AppModule DI
  // graph, which holds one shared TenantContextService instance (TenantContextModule is
  // @Global()). ctx.inTenant() runs on ctx's own separate TenantContextService — a different
  // AsyncLocalStorage entirely.
  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId: ctx.tenantId, correlationId: 'test' }, work);
  }

  async function entriesFor(invoiceId: string): Promise<FractionEntry[]> {
    return tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(FractionEntry).find({ where: { invoiceId } }),
    );
  }

  let seq = 0;

  async function makeDoctor(): Promise<string> {
    seq += 1;
    const account = await inTenant(() =>
      accountsService.createStaffAccount({
        username: `fraction_sub_dr${seq}`,
        email: `fraction_sub_dr${seq}@example.com`,
        displayName: `Fraction Sub Dr ${seq}`,
        password: 'correct-horse-battery-staple',
        roleName: 'Doctor',
      }),
    );
    return account.id;
  }

  async function makePatient(): Promise<string> {
    seq += 1;
    const patient = await inTenant(() =>
      patientsService.create({
        firstName: 'FractionSub',
        lastName: `Patient${seq}`,
        dateOfBirth: '1985-05-05',
        gender: 'Female',
        phoneNumber: `5570000${String(seq).padStart(3, '0')}`,
      }),
    );
    return patient.id;
  }

  async function makeEntry(invoiceId: string, doctorId: string): Promise<FractionEntry> {
    return inTenant(() =>
      fractionService.recordEntry({ invoiceId, doctorId, recordedBy: STAFF_ID }),
    );
  }

  it('reverses the invoice\'s fraction entries when the invoice is cancelled', async () => {
    await inTenant(async () => {
      const doctorId = await makeDoctor();
      const patientId = await makePatient();
      const invoice = await invoicesService.create({
        patientId,
        createdBy: STAFF_ID,
        items: [{ description: 'Consultation', unitPrice: 2000 }],
      });
      await fractionService.createRule({ doctorId, fractionPercent: 15 });
      const entry = await makeEntry(invoice.id, doctorId);
      expect(entry.reversedAt).toBeNull();

      await invoicesService.cancel(invoice.id);

      const [after] = await entriesFor(invoice.id);
      expect(after.reversedAt).not.toBeNull();
    });
  });

  it('reverses the invoice\'s fraction entries when a return is created against it', async () => {
    await inTenant(async () => {
      const doctorId = await makeDoctor();
      const patientId = await makePatient();
      const invoice = await invoicesService.create({
        patientId,
        createdBy: STAFF_ID,
        items: [{ description: 'Procedure', unitPrice: 5000 }],
      });
      await fractionService.createRule({ doctorId, fractionPercent: 10 });
      const entry = await makeEntry(invoice.id, doctorId);
      expect(entry.reversedAt).toBeNull();

      // createReturn requires a recorded payment to return against.
      await invoicesService.recordPayment(invoice.id, {
        amount: 5000,
        paymentMode: 'Cash',
        receivedBy: STAFF_ID,
      });
      await invoicesService.createReturn(invoice.id, {
        amount: 1000,
        reason: 'Partial refund',
        returnedBy: STAFF_ID,
      });

      const [after] = await entriesFor(invoice.id);
      expect(after.reversedAt).not.toBeNull();
    });
  });

  it('leaves entries untouched when an unrelated invoice update happens (no cancel/return)', async () => {
    await inTenant(async () => {
      const doctorId = await makeDoctor();
      const patientId = await makePatient();
      const invoice = await invoicesService.create({
        patientId,
        createdBy: STAFF_ID,
        items: [{ description: 'Consultation', unitPrice: 1000 }],
      });
      await fractionService.createRule({ doctorId, fractionPercent: 10 });
      await makeEntry(invoice.id, doctorId);

      // A payment updates the invoice but is neither a cancel nor a return — the entry stays live.
      await invoicesService.recordPayment(invoice.id, {
        amount: 1000,
        paymentMode: 'Cash',
        receivedBy: STAFF_ID,
      });

      const [after] = await entriesFor(invoice.id);
      expect(after.reversedAt).toBeNull();
    });
  });
});
