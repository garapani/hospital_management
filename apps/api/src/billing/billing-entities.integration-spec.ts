import { BillingSettings } from './entities/billing-settings.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Deposit } from './entities/deposit.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('Billing entities migration (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'billing_entities' });
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('creates all six billing tables, queryable and empty', async () => {
    await ctx.inTenant(async () => {
      await ctx.tenantConnection.runInTenantSchema(async (manager) => {
        expect(await manager.getRepository(BillingSettings).count()).toBe(0);
        expect(await manager.getRepository(Invoice).count()).toBe(0);
        expect(await manager.getRepository(InvoiceItem).count()).toBe(0);
        expect(await manager.getRepository(Payment).count()).toBe(0);
        expect(await manager.getRepository(Deposit).count()).toBe(0);
        const sequences = await manager.query(`SELECT * FROM billing_sequences`);
        expect(sequences).toEqual([]);
      });
    });
  });
});
