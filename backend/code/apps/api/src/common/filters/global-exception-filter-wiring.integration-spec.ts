import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app/app.module.js';
import { createApiValidationPipe } from '../../app/api-validation-pipe.js';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';
import { signTestToken } from '../../testing/test-jwt.js';

// Boots the real AppModule and registers the global exception filter + correlation-id echo the
// same way main.ts's bootstrap() does — neither is otherwise visible to any other integration
// spec, since none of them go through main.ts (see global-validation-pipe.integration-spec.ts for
// the identical rationale re: the ValidationPipe).
describe('GlobalExceptionFilter + correlation-id (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'global_exception_filter' });
    token = await signTestToken({
      sub: 'exception-filter-spec-user',
      hospitalId: ctx.tenantId,
      permissions: ['lab.read'],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('echoes a client-supplied x-correlation-id back on a successful response', async () => {
    const response = await request(app.getHttpServer())
      .get('/lab/tests/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .set('x-correlation-id', 'test-correlation-success');

    expect(response.headers['x-correlation-id']).toBe('test-correlation-success');
  });

  it('echoes a client-supplied x-correlation-id back on an error response too', async () => {
    // The route below 404s (unknown test id) — an HttpException the global filter formats.
    const response = await request(app.getHttpServer())
      .get('/lab/tests/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .set('x-correlation-id', 'test-correlation-error');

    expect(response.status).toBe(404);
    expect(response.headers['x-correlation-id']).toBe('test-correlation-error');
  });

  it('generates a correlation id when the client sends none', async () => {
    const response = await request(app.getHttpServer())
      .get('/lab/tests/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.headers['x-correlation-id']).toEqual(expect.any(String));
    expect(response.headers['x-correlation-id'].length).toBeGreaterThan(0);
  });

  it('formats an HttpException thrown by a real route into a consistent {statusCode, message} body via the global filter', async () => {
    const response = await request(app.getHttpServer())
      .get('/lab/tests/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ statusCode: 404 });
    expect(typeof response.body.message).toBe('string');
  });
});
