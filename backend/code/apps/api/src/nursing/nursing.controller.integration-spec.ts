import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';

describe('NursingController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;
  const staffId = '00000000-0000-4000-8000-0000000000a1';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'nursing_ctrl' });

    token = await signTestToken({
      sub: staffId,
      hospitalId: ctx.tenantId,
      permissions: ['nursing.read', 'nursing.manage'],
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

  let seq = 0;
  /** Inserts an admission row directly (nursing validates existence via raw query only).
   *  Each call uses a distinct patientId, since admissions.patientId is unique per active
   *  admission. */
  async function makeAdmission(): Promise<string> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO admissions ("patientId", "admissionSource", "admittingDoctorId", "wardId", "bedId")
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            `00000000-0000-0000-0000-d${String(seq).padStart(11, '0')}`,
            'OPD',
            staffId,
            '00000000-0000-4000-8000-0000000000c2',
            `00000000-0000-0000-0000-c${String(seq).padStart(11, '0')}`,
          ],
        ),
      ),
    );
    return rows[0].id;
  }

  it('actually pages the tasks list instead of always returning page 1', async () => {
    // Regression test for the P1 fix: ListTasksQueryDto now extends PaginationQueryDto,
    // so page/limit survive the global whitelist ValidationPipe instead of being
    // silently stripped before reaching NursingService.listTasks.
    const admissionId = await makeAdmission();
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/nursing/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ admissionId, taskType: 'Vitals Check', description: `Round ${i}` })
        .expect(201);
    }

    const page1 = await request(app.getHttpServer())
      .get(`/nursing/tasks?admissionId=${admissionId}&page=1&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page1.body.meta.page).toBe(1);
    expect(page1.body.meta.limit).toBe(1);
    expect(page1.body.meta.total).toBe(3);
    expect(page1.body.data).toHaveLength(1);

    const page2 = await request(app.getHttpServer())
      .get(`/nursing/tasks?admissionId=${admissionId}&page=2&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.meta.page).toBe(2);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
  });

  it('actually pages the administrations list instead of always returning page 1', async () => {
    const admissionId = await makeAdmission();
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/nursing/administrations')
        .set('Authorization', `Bearer ${token}`)
        .send({ admissionId, drugName: 'Paracetamol', dose: '500mg' })
        .expect(201);
    }

    const page1 = await request(app.getHttpServer())
      .get(`/nursing/administrations?admissionId=${admissionId}&page=1&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page1.body.meta.page).toBe(1);
    expect(page1.body.meta.total).toBe(3);
    expect(page1.body.data).toHaveLength(1);

    const page2 = await request(app.getHttpServer())
      .get(`/nursing/administrations?admissionId=${admissionId}&page=2&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.meta.page).toBe(2);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
  });

  it('creates, lists, and acknowledges a shift handoff note end-to-end', async () => {
    const admissionId = await makeAdmission();

    const created = await request(app.getHttpServer())
      .post('/nursing/handoff-notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ admissionId, shift: 'Night', note: 'Patient anxious, reassured; recheck vitals at 2am.' })
      .expect(201);
    expect(created.body.acknowledged).toBe(false);

    const listed = await request(app.getHttpServer())
      .get(`/nursing/handoff-notes?admissionId=${admissionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(created.body.id);

    const acknowledged = await request(app.getHttpServer())
      .post(`/nursing/handoff-notes/${created.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(acknowledged.body.acknowledged).toBe(true);
    expect(acknowledged.body.acknowledgedBy).toBe(staffId);

    await request(app.getHttpServer())
      .post(`/nursing/handoff-notes/${created.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('rejects creating a handoff note with 403 for a read-only token', async () => {
    const admissionId = await makeAdmission();
    const readOnlyToken = await signTestToken({
      sub: staffId,
      hospitalId: ctx.tenantId,
      permissions: ['nursing.read'],
    });

    await request(app.getHttpServer())
      .post('/nursing/handoff-notes')
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ admissionId, note: 'x' })
      .expect(403);
  });

  it('rejects an unrecognized shift value with 400, not a raw 500', async () => {
    const admissionId = await makeAdmission();
    await request(app.getHttpServer())
      .post('/nursing/handoff-notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ admissionId, shift: 'Midnight', note: 'x' })
      .expect(400);
  });
});
