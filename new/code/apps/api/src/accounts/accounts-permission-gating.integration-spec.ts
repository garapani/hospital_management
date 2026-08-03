import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { AccountsModule } from './accounts.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AccountsController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let accountId: string;
  let noPermissionHeaders: Record<string, string>;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'permission_gating', seedRbac: true });
    noPermissionHeaders = {
      'x-tenant-id': ctx.tenantId,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const account = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'no.permission.doctor',
        email: 'noperm@example.com',
        displayName: 'No Permission Doctor',
        password: 'a-doctor-password',
        roleName: 'Doctor',
      }),
    );
    accountId = account.id;

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('rejects account creation with 403 when no identity.accounts.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set(noPermissionHeaders)
      .send({
        username: 'blocked.user',
        email: 'blocked@example.com',
        displayName: 'Blocked User',
        password: 'a-blocked-password',
        roleName: 'Nurse',
      });
    expect(response.status).toBe(403);
  });

  it('rejects listing accounts with 403 when no identity.accounts.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/accounts').set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects getting a single account with 403 when no identity.accounts.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects deactivate/reactivate/unlock with 403 when no identity.accounts.manage permission is granted', async () => {
    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/deactivate`)
      .set(noPermissionHeaders);
    expect(deactivateResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/reactivate`)
      .set(noPermissionHeaders);
    expect(reactivateResponse.status).toBe(403);

    const unlockResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/unlock`)
      .set(noPermissionHeaders);
    expect(unlockResponse.status).toBe(403);
  });

  it('rejects role assignment and revocation with 403 when no identity.accounts.manage permission is granted', async () => {
    const assignResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set(noPermissionHeaders)
      .send({ roleName: 'Nurse' });
    expect(assignResponse.status).toBe(403);

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/accounts/${accountId}/roles/00000000-0000-0000-0000-000000000000`)
      .set(noPermissionHeaders);
    expect(revokeResponse.status).toBe(403);
  });
});
