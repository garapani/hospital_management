import { AuditService } from './audit.service.js';
import { SearchAuditRecordsDto } from './dto/search-audit-records.dto.js';
import { AuditRecord } from './entities/audit-record.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AuditService recordId filter (integration)', () => {
  let ctx: TenantTestContext;
  let auditService: AuditService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'audit_search' });
    auditService = new AuditService(ctx.tenantConnection);

    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        const repository = manager.getRepository(AuditRecord);
        const seed = (
          tableName: string,
          recordId: string,
          changedByAccountId: string,
        ) =>
          repository.save(
            repository.create({
              tableName,
              recordId,
              action: 'create',
              changedByAccountId,
              correlationId: null,
              diff: [],
              occurredAt: new Date(),
            }),
          );
        await seed('tenants', 'tenant-abc', 'u1');
        await seed('tenants', 'tenant-def', 'u1');
        await seed('accounts', 'tenant-abc', 'u2');
      }),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function query(): SearchAuditRecordsDto {
    const q = new SearchAuditRecordsDto();
    q.page = 1;
    q.limit = 50;
    return q;
  }

  it('filters by recordId alone, and combined with tableName', async () => {
    const byRecord = await ctx.inTenant(() =>
      auditService.getAuditRecords({ recordId: 'tenant-abc' }, query()),
    );
    expect(byRecord.data).toHaveLength(2);

    const byRecordAndTable = await ctx.inTenant(() =>
      auditService.getAuditRecords({ recordId: 'tenant-abc', tableName: 'tenants' }, query()),
    );
    expect(byRecordAndTable.data).toHaveLength(1);
    expect(byRecordAndTable.data[0].tableName).toBe('tenants');
  });

  it('returns nothing for a recordId with no audit rows', async () => {
    const result = await ctx.inTenant(() =>
      auditService.getAuditRecords({ recordId: 'no-such-record' }, query()),
    );
    expect(result.data).toHaveLength(0);
  });
});
