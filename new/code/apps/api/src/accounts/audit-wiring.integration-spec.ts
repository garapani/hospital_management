import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AUDIT_EVENT_PUBLISHER, AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
} from '../testing/tenant-test-context.js';

describe('Audit wiring (integration)', () => {
  it('publishes a create event for a new staff account with passwordHash excluded from the diff', async () => {
    const published: AuditEvent[] = [];
    const testPublisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const ctx = await setupTenantTestContext({ namePrefix: 'audit_wiring', seedRbac: true });

    // Override the DI graph's DataSource and TenantContextService with ctx's own instances, so the
    // DI-resolved AccountsService below sees the schema ctx provisioned and the tenant context
    // ctx.inTenant() sets (TenantContextService owns a private AsyncLocalStorage per instance).
    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(AUDIT_EVENT_PUBLISHER)
      .useValue(testPublisher)
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .overrideProvider(TenantContextService)
      .useValue(ctx.tenantContext)
      .compile();
    await moduleRef.init();

    const accountsService = moduleRef.get(AccountsService);

    await ctx.inTenant(() =>
      accountsService.createStaffAccount({
        username: 'audit.test',
        email: 'audit@example.com',
        displayName: 'Audit Test',
        password: 'a-strong-password',
        roleName: 'Doctor',
      }),
    );

    const accountEvent = published.find((event) => event.tableName === 'accounts');
    expect(accountEvent).toMatchObject({ action: 'create' });
    expect(accountEvent?.diff.some((entry) => entry.field === 'passwordHash')).toBe(false);
    expect(accountEvent?.diff.some((entry) => entry.field === 'username')).toBe(true);

    await teardownTenantTestContext(ctx);
    await moduleRef.close();
  });
});
