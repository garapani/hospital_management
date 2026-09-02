import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import { AuditRecord } from './entities/audit-record.entity.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import { createAuditDataSource } from '../database/audit-data-source.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('PersistingAuditEventPublisher (integration)', () => {
  let ctx: TenantTestContext;
  let auditDataSource: DataSource;
  let publisher: PersistingAuditEventPublisher;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'audit_persist' });
    auditDataSource = createAuditDataSource();
    await auditDataSource.initialize();
    publisher = new PersistingAuditEventPublisher(ctx.tenantConnection, auditDataSource);
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    if (auditDataSource.isInitialized) {
      await auditDataSource.destroy();
    }
  });

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

  it('writes audit records on a dedicated, bounded connection pool', () => {
    // Same rationale as PersistingReportingEventPublisher's identical test: audit writes take a
    // *second* connection while the business transaction still holds its own. If both came from
    // the same pool, N concurrent audited writes at pool capacity would block forever
    // (node-postgres defaults to connectionTimeoutMillis: 0 = wait indefinitely). A pool object
    // distinct from the main one, capped, with a finite acquisition timeout is what bounds that.
    expect(auditDataSource).not.toBe(ctx.dataSource);
    expect(auditDataSource.isInitialized).toBe(true);
    expect(auditDataSource.options.extra).toMatchObject({
      max: 3,
      connectionTimeoutMillis: 2000,
    });
    expect(auditDataSource.options.migrations).toEqual([]);
    expect(auditDataSource.options.entities).toEqual([AuditRecord]);
  });

  it('routes audit writes through the dedicated pool, not the main one', async () => {
    // Pins the second argument to `runInTenantSchema` in persisting-audit-event-publisher.ts.
    // Every other test in this file exercises the publisher without inspecting which pool actually
    // served the write, so silently dropping that second argument — reverting audit writes to the
    // shared main pool and reintroducing the pool-contention risk this fix exists to prevent —
    // would leave every existing test green.
    const spy = jest.spyOn(ctx.tenantConnection, 'runInTenantSchema');

    try {
      await ctx.inTenant(() =>
        publisher.publish({
          tableName: 'accounts',
          recordId: '33333333-3333-3333-3333-333333333333',
          action: 'create',
          diff: [],
          occurredAt: new Date().toISOString(),
        }),
      );

      expect(spy.mock.calls.some(([, dataSourceArg]) => dataSourceArg === auditDataSource)).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('fails fast instead of hanging when the audit pool is exhausted', async () => {
    // Proves the mechanism the config above relies on: with a bounded `max` and a finite
    // `connectionTimeoutMillis`, an over-capacity acquisition rejects rather than waiting forever.
    // A throwaway 1-connection / 200ms clone keeps this deterministic and fast.
    const tinyPool = new DataSource({
      ...createAuditDataSource().options,
      extra: { max: 1, connectionTimeoutMillis: 200 },
    } as DataSourceOptions);
    await tinyPool.initialize();

    const held = tinyPool.createQueryRunner();
    await held.connect();
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
});
