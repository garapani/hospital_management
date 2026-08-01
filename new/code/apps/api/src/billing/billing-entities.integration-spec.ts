import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillingSettings } from './entities/billing-settings.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Deposit } from './entities/deposit.entity.js';

describe('Billing entities migration (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let tenantId: string;

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);

    const uniqueId = Date.now().toString();
    const tenant = await tenantsService.provisionTenant({
      hospitalId: `billing_entities_${uniqueId}`,
      hospitalName: 'Billing Entities Hospital',
    });
    tenantId = tenant.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId, correlationId: 'test' }, work);
  }

  it('creates all six billing tables, queryable and empty', async () => {
    await inTenant(async () => {
      await tenantConnection.runInTenantSchema(async (manager) => {
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
