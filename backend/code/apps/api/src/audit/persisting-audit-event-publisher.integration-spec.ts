import { AuditRecord } from './entities/audit-record.entity.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PersistingAuditEventPublisher (integration)', () => {
  let ctx: TenantTestContext;
  let publisher: PersistingAuditEventPublisher;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'audit_persist' });
    publisher = new PersistingAuditEventPublisher(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('persists an audit record into the current tenant schema', async () => {
    await ctx.inTenant(() =>
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

    const records = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
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
