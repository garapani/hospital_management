import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';

describe('BillingSettingsController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountsService: AccountsService;
  const TEST_TENANT_ID = 'test_billing_settings_e2e';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = globalDataSource;
    accountsService = moduleFixture.get(AccountsService);

    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID);
  });

  afterAll(async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID}" CASCADE`);
    } finally {
      await queryRunner.release();
    }
    await app.close();
  });

  it('fails with 401/403 when reading billing settings', async () => {
    const res = await request(app.getHttpServer()).get('/billing/settings');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when updating billing settings', async () => {
    const res = await request(app.getHttpServer())
      .patch('/billing/settings')
      .send({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital' });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });
});
