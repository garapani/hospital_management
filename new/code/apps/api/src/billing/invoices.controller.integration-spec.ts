import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';

describe('InvoicesController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountsService: AccountsService;
  const TEST_TENANT_ID = 'test_invoices_e2e';

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

  it('fails with 401/403 when creating an invoice', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/invoices')
      .send({
        patientId: '00000000-0000-0000-0000-000000000000',
        createdBy: '00000000-0000-0000-0000-000000000000',
        items: [{ description: 'Consultation Fee', unitPrice: 500 }],
      });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when listing invoices', async () => {
    const res = await request(app.getHttpServer()).get('/billing/invoices');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when recording a payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/invoices/00000000-0000-0000-0000-000000000000/payments')
      .send({ amount: 100, paymentMode: 'Cash', receivedBy: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });
});
