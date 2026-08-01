import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillingSettingsService } from './billing-settings.service.js';

describe('BillingSettingsService (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let billingSettingsService: BillingSettingsService;

  let tenantId1: string;
  let tenantId2: string;

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);
    billingSettingsService = new BillingSettingsService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({ hospitalId: `billset_1_${uniqueId}`, hospitalName: 'Billing Settings Hospital 1' });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({ hospitalId: `billset_2_${uniqueId}`, hospitalName: 'Billing Settings Hospital 2' });
    tenantId2 = t2.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId2);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId, correlationId: 'test' }, work);
  }

  it('returns null before any settings are saved', async () => {
    const settings = await inTenant(tenantId1, () => billingSettingsService.get());
    expect(settings).toBeNull();
  });

  it('creates settings on first update', async () => {
    const settings = await inTenant(tenantId1, () =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital Pvt Ltd' }),
    );
    expect(settings.id).toBe('default');
    expect(settings.gstin).toBe('27AAAAA0000A1Z5');
    expect(settings.stateCode).toBe('27');
    expect(settings.hospitalLegalName).toBe('Test Hospital Pvt Ltd');

    const fetched = await inTenant(tenantId1, () => billingSettingsService.get());
    expect(fetched?.gstin).toBe('27AAAAA0000A1Z5');
  });

  it('overwrites settings on a second update instead of creating a duplicate row', async () => {
    await inTenant(tenantId1, () =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital Pvt Ltd' }),
    );
    const updated = await inTenant(tenantId1, () =>
      billingSettingsService.update({ gstin: '29BBBBB1111B2Z6', stateCode: '29', hospitalLegalName: 'Renamed Hospital Pvt Ltd' }),
    );
    expect(updated.id).toBe('default');
    expect(updated.gstin).toBe('29BBBBB1111B2Z6');

    const fetched = await inTenant(tenantId1, () => billingSettingsService.get());
    expect(fetched?.gstin).toBe('29BBBBB1111B2Z6');
  });

  it('enforces tenant isolation', async () => {
    await inTenant(tenantId1, () =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Tenant 1 Hospital' }),
    );
    const tenant2Settings = await inTenant(tenantId2, () => billingSettingsService.get());
    expect(tenant2Settings).toBeNull();
  });
});
