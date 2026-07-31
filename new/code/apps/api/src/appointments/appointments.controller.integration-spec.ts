import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';

describe('AppointmentsController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountsService: AccountsService;
  const TEST_TENANT_ID = 'test_appointments_e2e';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = globalDataSource;
    accountsService = moduleFixture.get(AccountsService);
    
    // Ensure data source is initialized (it might be initialized by the app)
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    // Provision the schema for the test tenant
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

  it('fails with 403 when creating without proper permissions', async () => {
    // Missing correlation logic/auth headers since we do not inject a valid JWT in this simple E2E, 
    // it should fail at the AuthGuard layer or return 401/403.
    // In our app, we expect 401 Unauthorized or 403 Forbidden.
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        contactNumber: '1234567890',
        appointmentDate: '2026-08-01',
        appointmentTime: '10:00',
        appointmentType: 'Consultation',
      });
      
    expect([HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN]).toContain(res.status);
  });
});
