import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AUDIT_EVENT_PUBLISHER, AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
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

  it('audits failed-login, lock, and reset mutations on an account', async () => {
    const published: AuditEvent[] = [];
    const testPublisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const ctx = await setupTenantTestContext({ namePrefix: 'audit_wiring', seedRbac: true });

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

    await ctx.inTenant(async () => {
      const account = await accountsService.createStaffAccount({
        username: 'audit.login',
        email: 'login@example.com',
        displayName: 'Audit Login',
        password: 'a-strong-password',
        roleName: 'Doctor',
      });

      // These go through repository.save() (findOne + mutate + save), so the AuditSubscriber's
      // afterUpdate fires for each — raw increment()/update() calls would bypass auditing
      // entirely. A failed login and its resulting lock are security-relevant and belong in the
      // audit trail.
      await accountsService.recordFailedLogin(account.id);
      await accountsService.lockAccount(account.id, new Date(Date.now() + 60_000));
      await accountsService.resetFailedLogins(account.id);
    });

    const updateEvents = published.filter(
      (event) => event.tableName === 'accounts' && event.action === 'update',
    );
    expect(updateEvents.length).toBeGreaterThanOrEqual(3);
    expect(
      updateEvents.some((event) =>
        event.diff.some((entry) => entry.field === 'failedLoginAttempts'),
      ),
    ).toBe(true);
    expect(
      updateEvents.some((event) => event.diff.some((entry) => entry.field === 'lockedUntil')),
    ).toBe(true);
    // resetFailedLogins clears both fields back to their defaults in one save — one update event
    // carries both.
    expect(
      updateEvents.some(
        (event) =>
          event.diff.some((entry) => entry.field === 'failedLoginAttempts') &&
          event.diff.some((entry) => entry.field === 'lockedUntil'),
      ),
    ).toBe(true);

    await teardownTenantTestContext(ctx);
    await moduleRef.close();
  });

  it('resolves the recordId from the entity real primary key (Tenant.hospitalId, not a hardcoded id)', async () => {
    const published: AuditEvent[] = [];
    const testPublisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const ctx = await setupTenantTestContext({ namePrefix: 'audit_pk', seedRbac: true });

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(AUDIT_EVENT_PUBLISHER)
      .useValue(testPublisher)
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .overrideProvider(TenantContextService)
      .useValue(ctx.tenantContext)
      .compile();
    await moduleRef.init();

    const tenantRepository = ctx.dataSource.getRepository(Tenant);
    await ctx.tenantContext.run({ tenantId: ctx.tenantId, correlationId: 'audit-pk' }, () =>
      tenantRepository.save(
        tenantRepository.create({
          hospitalId: 'audit_pk_tenant',
          hospitalName: 'Audit PK Tenant',
          status: 'active',
          packageCode: 'basic',
          activatedAt: new Date(),
          suspendedAt: null,
          createdBy: 'audit-pk-spec',
        }),
      ),
    );

    const event = published.find((e) => e.tableName === 'tenants');
    expect(event).toBeDefined();
    expect(event?.recordId).toBe('audit_pk_tenant');

    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, ['audit_pk_tenant']);
    await teardownTenantTestContext(ctx);
    await moduleRef.close();
  });
});
