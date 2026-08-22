import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module.js';
import { createApiValidationPipe } from './api-validation-pipe.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';

// Boots the real AppModule the same way app-module-auth-wiring.integration-spec.ts does, but this
// spec also registers the global ValidationPipe the way main.ts's bootstrap() does — that pipe is
// otherwise invisible to every other integration spec, since none of them go through main.ts. This
// is the one place proving the Phase A pipe (see
// new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md) is actually wired end to
// end, not just unit-testable in isolation.
describe('Global ValidationPipe (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'global_validation_pipe' });
    token = await signTestToken({
      sub: 'validation-pipe-spec-user',
      hospitalId: ctx.tenantId,
      permissions: ['lab.catalog.manage', 'reporting.read', 'billing.manage'],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  // LabCatalogService.updateTestPrice also has its own manual Number.isFinite/>=0 guard
  // (defense in depth, predates this pipe), so these two don't by themselves prove the pipe is
  // doing new work — the array-typed patientId case below does. Kept as basic wiring sanity: the
  // route responds the same way end to end with the pipe active.
  it('rejects a negative price on UpdatePriceDto with 400', async () => {
    const response = await request(app.getHttpServer())
      .patch('/lab/tests/00000000-0000-0000-0000-000000000000/price')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({ price: -5 });

    expect(response.status).toBe(400);
  });

  it('a valid positive price passes validation and reaches the service (404 for the nonexistent test, not 400)', async () => {
    const response = await request(app.getHttpServer())
      .patch('/lab/tests/00000000-0000-0000-0000-000000000000/price')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({ price: 42 });

    expect(response.status).not.toBe(400);
  });

  it('rejects an invalid `action` enum value on SearchAuditRecordsDto with 400', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit')
      .query({ action: 'not-a-real-action' })
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.status).toBe(400);
  });

  it('rejects a non-numeric page on SearchAuditRecordsDto with 400 (previously silently accepted, since @Type(() => Number) never ran)', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit')
      .query({ page: 'not-a-page' })
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.status).toBe(400);
  });

  it('coerces page/limit query strings to numbers on SearchAuditRecordsDto instead of leaving them as strings', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit')
      .query({ page: '2', limit: '10' })
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.status).toBe(200);
    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.limit).toBe(10);
  });

  it('rejects an array-valued patientId on ListInvoicesDto with 400 instead of letting it reach the query builder (previously dead @IsString validator)', async () => {
    // Repeating a query key (?patientId=a&patientId=b) parses to an array under Express's default
    // query parser. InvoicesService.list() has no guard against this — it binds query.patientId
    // straight into a TypeORM `=` comparison, which the DB driver would reject at the SQL layer
    // (a 500) with no pipe active. @IsString() now catches it before the service ever runs.
    const response = await request(app.getHttpServer())
      .get('/billing/invoices?patientId=a&patientId=b')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.status).toBe(400);
  });

  it('list endpoints backed by the undecorated PaginationQueryDto are unaffected (whitelist stays off)', async () => {
    const response = await request(app.getHttpServer())
      .get('/billing/invoices')
      .query({ page: '1', limit: '5' })
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });
});
