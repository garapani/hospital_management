import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';

describe('DepositsController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountsService: AccountsService;
  const TEST_TENANT_ID = 'test_deposits_e2e';

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

  it('fails with 401/403 when creating a deposit', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/deposits')
      .send({ patientId: '00000000-0000-0000-0000-000000000000', amount: 1000, receivedBy: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when listing deposits', async () => {
    const res = await request(app.getHttpServer()).get('/billing/deposits');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });
});
