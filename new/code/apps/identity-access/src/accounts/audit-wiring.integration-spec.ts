import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AUDIT_EVENT_PUBLISHER, AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';

describe('Audit wiring (integration)', () => {
  it('publishes a create event for a new staff account with passwordHash excluded from the diff', async () => {
    const published: AuditEvent[] = [];
    const testPublisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(AUDIT_EVENT_PUBLISHER)
      .useValue(testPublisher)
      .compile();
    await moduleRef.init();

    const dataSource = moduleRef.get(DataSource);
    const tenantContext = moduleRef.get(TenantContextService);
    const accountsService = moduleRef.get(AccountsService);

    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_audit_wiring');

    await tenantContext.run({ tenantId: 'test_audit_wiring', correlationId: 'setup' }, () =>
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

    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_audit_wiring" CASCADE`);
    await dataSource.destroy();
    await moduleRef.close();
  });
});
