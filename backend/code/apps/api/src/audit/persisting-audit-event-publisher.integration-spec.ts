import { AuditRecord } from './entities/audit-record.entity.js';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import { dispatchTenant } from '../database/outbox-dispatcher-entrypoint.js';
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
    publisher = new PersistingAuditEventPublisher();
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('writes an Audit-kind outbox row on the caller-supplied manager, in the current tenant schema', async () => {
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        publisher.publish(
          {
            tableName: 'accounts',
            recordId: '11111111-1111-1111-1111-111111111111',
            action: 'create',
            hospitalId: ctx.tenantId,
            changedByAccountId: '22222222-2222-2222-2222-222222222222',
            correlationId: 'test-correlation',
            diff: [{ field: 'username', before: null, after: 'dr.alice' }],
            occurredAt: new Date().toISOString(),
          },
          manager,
        ),
      ),
    );

    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(OutboxEvent).find({ where: { kind: 'Audit' } }),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Pending');
    expect(rows[0].payload).toMatchObject({
      tableName: 'accounts',
      recordId: '11111111-1111-1111-1111-111111111111',
      action: 'create',
      correlationId: 'test-correlation',
      diff: [{ field: 'username', before: null, after: 'dr.alice' }],
    });
  });

  it('materializes into audit_records once the outbox dispatcher drains it', async () => {
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        publisher.publish(
          {
            tableName: 'patients',
            recordId: '33333333-3333-3333-3333-333333333333',
            action: 'update',
            hospitalId: ctx.tenantId,
            diff: [{ field: 'phoneNumber', before: '1', after: '2' }],
            occurredAt: new Date().toISOString(),
          },
          manager,
        ),
      ),
    );

    await dispatchTenant(`tenant_${ctx.tenantId}`);

    const records = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(AuditRecord).find({ where: { tableName: 'patients' } }),
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].recordId).toBe('33333333-3333-3333-3333-333333333333');
    expect(records[0].action).toBe('update');
  });

  it('rolls the outbox row back together with the business write it was part of', async () => {
    await expect(
      ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema(async (manager) => {
          await publisher.publish(
            {
              tableName: 'accounts',
              recordId: '44444444-4444-4444-4444-444444444444',
              action: 'create',
              hospitalId: ctx.tenantId,
              diff: [],
              occurredAt: new Date().toISOString(),
            },
            manager,
          );
          throw new Error('simulated failure elsewhere in the same business transaction');
        }),
      ),
    ).rejects.toThrow('simulated failure elsewhere in the same business transaction');

    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(OutboxEvent).find({
          where: { kind: 'Audit' },
        }),
      ),
    );
    expect(rows.find((r) => (r.payload as { recordId: string }).recordId === '44444444-4444-4444-4444-444444444444')).toBeUndefined();
  });

  it('skips without throwing for a platform-level write (manager on the public schema)', async () => {
    // Regression case for the real bug this test exists to pin: every JWT in this app carries a
    // hospitalId claim regardless of whether the endpoint is tenant-scoped or platform-admin, so
    // `event.hospitalId` looked like it could gate this but can't — a platform-admin action still
    // writes on the main, public-schema-search-path manager. ctx.dataSource.manager (no
    // runInTenantSchema wrapper) reproduces that: a real manager whose connection resolves
    // current_schema() to 'public', not a tenant schema.
    await expect(
      publisher.publish(
        {
          tableName: 'subscriptions',
          recordId: 'x',
          action: 'create',
          hospitalId: ctx.tenantId,
          diff: [],
          occurredAt: new Date().toISOString(),
        },
        ctx.dataSource.manager,
      ),
    ).resolves.toBeUndefined();
  });

  it('throws if published with no manager at all', async () => {
    await expect(
      publisher.publish({
        tableName: 'accounts',
        recordId: 'x',
        action: 'create',
        hospitalId: ctx.tenantId,
        diff: [],
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/requires a manager/);
  });
});
