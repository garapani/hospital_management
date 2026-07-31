import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';

describe('PersistingAuditEventPublisher (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const publisher = new PersistingAuditEventPublisher(tenantConnection);

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, 'test_audit_persist');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_audit_persist" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_audit_persist', correlationId: 'test-correlation' }, work);
  }

  it('persists an audit record into the current tenant schema', async () => {
    await inTenant(() =>
      publisher.publish({
        tableName: 'accounts',
        recordId: '11111111-1111-1111-1111-111111111111',
        action: 'create',
        hospitalId: 'test_audit_persist',
        changedByAccountId: '22222222-2222-2222-2222-222222222222',
        correlationId: 'test-correlation',
        diff: [{ field: 'username', before: null, after: 'dr.alice' }],
        occurredAt: new Date().toISOString(),
      }),
    );

    const records = await inTenant(() =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(AuditRecord).find({ where: { tableName: 'accounts' } }),
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].recordId).toBe('11111111-1111-1111-1111-111111111111');
    expect(records[0].action).toBe('create');
    expect(records[0].correlationId).toBe('test-correlation');
    expect(records[0].diff).toEqual([{ field: 'username', before: null, after: 'dr.alice' }]);
  });

  it('swallows and logs a persist failure instead of throwing (no tenant context set)', async () => {
    await expect(
      publisher.publish({
        tableName: 'accounts',
        recordId: 'x',
        action: 'create',
        diff: [],
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
