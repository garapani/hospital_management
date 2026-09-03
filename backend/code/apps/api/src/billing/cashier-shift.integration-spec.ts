import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, INestApplication } from '@nestjs/common';
import { AppModule } from '../app/app.module.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PatientsService } from '../patients/patients.service.js';
import { InvoicesService } from './invoices.service.js';
import { CashierShiftService } from './cashier-shift.service.js';
import { Payment } from './entities/payment.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('Cashier shift open/close + reconciliation (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantContextService: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;
  let cashierShiftService: CashierShiftService;

  const CASHIER_A = '00000000-0000-4000-8000-000000000101';
  const CASHIER_B = '00000000-0000-4000-8000-000000000102';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ctx = await setupTenantTestContext({ namePrefix: 'cashier_shift' });

    tenantContextService = moduleFixture.get(TenantContextService);
    tenantConnection = moduleFixture.get(TenantConnectionService);
    patientsService = moduleFixture.get(PatientsService);
    invoicesService = moduleFixture.get(InvoicesService);
    cashierShiftService = moduleFixture.get(CashierShiftService);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  // DI-resolved services share the AppModule's single TenantContextService instance (matches
  // charge-capture.integration-spec.ts's rationale — ctx.inTenant() would not work here).
  function asAccount<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run(
      { tenantId: ctx.tenantId, accountId, correlationId: 'cashier-shift-test' },
      work,
    );
  }

  async function makePatient(phoneNumber: string) {
    return asAccount(CASHIER_A, () =>
      patientsService.create({
        firstName: 'Shift', lastName: 'Patient', gender: 'Female', phoneNumber,
      }),
    );
  }

  async function recordCashInvoice(accountId: string, amount: number, mode: 'Cash' | 'Card' | 'UPI', phoneNumber: string) {
    const patient = await makePatient(phoneNumber);
    return asAccount(accountId, async () => {
      const invoice = await invoicesService.create({
        patientId: patient.id,
        items: [{ description: 'Consultation', unitPrice: amount }],
      });
      return invoicesService.recordPayment(invoice.id, { amount, paymentMode: mode });
    });
  }

  it('opens a shift for the current account', async () => {
    const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 2000 }));

    expect(shift.status).toBe('Open');
    expect(shift.openedBy).toBe(CASHIER_A);
    expect(shift.floatAmount).toBe(2000);

    // Cleanup so later tests in this file start fresh.
    await asAccount(CASHIER_A, () =>
      cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
    );
  });

  it('rejects opening a second shift for an account that already has one open', async () => {
    const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 1000 }));

    await expect(
      asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 500 })),
    ).rejects.toThrow(ConflictException);

    await asAccount(CASHIER_A, () =>
      cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
    );
  });

  it('getCurrentShift returns the account\'s own open shift, and null once closed', async () => {
    const shift = await asAccount(CASHIER_B, () => cashierShiftService.openShift({ floatAmount: 1500 }));

    const current = await asAccount(CASHIER_B, () => cashierShiftService.getCurrentShift());
    expect(current?.id).toBe(shift.id);

    await asAccount(CASHIER_B, () =>
      cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
    );
    const afterClose = await asAccount(CASHIER_B, () => cashierShiftService.getCurrentShift());
    expect(afterClose).toBeNull();
  });

  it('a payment recorded with no open shift is left untagged (shiftId null)', async () => {
    const payment = await recordCashInvoice(CASHIER_A, 300, 'Cash', '5551110001');

    const stored = await asAccount(CASHIER_A, () =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Payment).findOne({ where: { id: payment.id } }),
      ),
    );
    expect(stored?.shiftId).toBeNull();
  });

  it('a payment recorded while a shift is open is auto-tagged with it (PaymentShiftTagSubscriber)', async () => {
    const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 1000 }));

    const payment = await recordCashInvoice(CASHIER_A, 400, 'Cash', '5551110002');

    const stored = await asAccount(CASHIER_A, () =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Payment).findOne({ where: { id: payment.id } }),
      ),
    );
    expect(stored?.shiftId).toBe(shift.id);

    await asAccount(CASHIER_A, () =>
      cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
    );
  });

  describe('close + reconciliation', () => {
    it('computes the cash declared total from denomination counts and reconciles cash vs card against recorded payments', async () => {
      const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 500 }));

      // 500 cash + 300 cash recorded during the shift = 800 expected cash.
      await recordCashInvoice(CASHIER_A, 500, 'Cash', '5552220001');
      await recordCashInvoice(CASHIER_A, 300, 'Cash', '5552220002');
      // 1200 card recorded during the shift = 1200 expected card.
      await recordCashInvoice(CASHIER_A, 1200, 'Card', '5552220003');

      const result = await asAccount(CASHIER_A, () =>
        cashierShiftService.closeShift(shift.id, {
          // 2*200 + 4*100 = 800, matching the float's own worth counted back plus takings.
          cashDenominationCounts: { '200': 2, '100': 4 },
          modeDeclaredTotals: { Card: 1150 },
        }),
      );

      expect(result.shift.status).toBe('Closed');
      expect(result.shift.cashDeclaredTotal).toBe(800);

      const cash = result.modes.find((m) => m.paymentMode === 'Cash');
      expect(cash).toMatchObject({ expectedAmount: 800, declaredAmount: 800, variance: 0 });

      const card = result.modes.find((m) => m.paymentMode === 'Card');
      // Declared 1150 vs expected 1200 -> a 50 shortage.
      expect(card).toMatchObject({ expectedAmount: 1200, declaredAmount: 1150, variance: -50 });
    });

    it('rejects an unknown denomination key', async () => {
      const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 0 }));

      await expect(
        asAccount(CASHIER_A, () =>
          cashierShiftService.closeShift(shift.id, { cashDenominationCounts: { '30': 1 } }),
        ),
      ).rejects.toThrow(BadRequestException);

      await asAccount(CASHIER_A, () =>
        cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
      );
    });

    it('rejects closing an already-closed shift', async () => {
      const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 0 }));
      await asAccount(CASHIER_A, () =>
        cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
      );

      await expect(
        asAccount(CASHIER_A, () =>
          cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('only the account that opened the shift can close it', async () => {
      const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 0 }));

      await expect(
        asAccount(CASHIER_B, () =>
          cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
        ),
      ).rejects.toThrow(ForbiddenException);

      await asAccount(CASHIER_A, () =>
        cashierShiftService.closeShift(shift.id, { cashDenominationCounts: {} }),
      );
    });
  });

  describe('getReconciliation', () => {
    it('returns the same expected/declared/variance shape for an already-closed shift', async () => {
      const shift = await asAccount(CASHIER_A, () => cashierShiftService.openShift({ floatAmount: 0 }));
      await recordCashInvoice(CASHIER_A, 250, 'Cash', '5553330001');
      await asAccount(CASHIER_A, () =>
        cashierShiftService.closeShift(shift.id, { cashDenominationCounts: { '100': 2, '50': 1 } }),
      );

      const reconciliation = await asAccount(CASHIER_A, () => cashierShiftService.getReconciliation(shift.id));
      const cash = reconciliation.modes.find((m) => m.paymentMode === 'Cash');
      expect(cash).toMatchObject({ expectedAmount: 250, declaredAmount: 250, variance: 0 });
    });
  });
});
