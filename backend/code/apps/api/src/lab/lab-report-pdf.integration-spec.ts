import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { LabModule } from './lab.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';
import { AccountsService } from '../accounts/accounts.service.js';

describe('Lab report PDF export (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let labToken: string;

  let catalogService: LabCatalogService;
  let labWorkflowService: LabWorkflowService;
  let ordersService: OrdersService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'lab_report_pdf' });

    labToken = await signTestToken({
      sub: 'lab-report-reader',
      hospitalId: ctx.tenantId,
      permissions: ['lab.read'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, LabModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(new AuthContextMiddleware(jwtService).use.bind(new AuthContextMiddleware(jwtService)));
    app.use(new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)));
    await app.init();

    // Standalone service instances for the setup flow (same construction as the workflow spec).
    catalogService = new LabCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      patientsService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
  });

  afterAll(async () => {
    // Teardown BEFORE app.close(): closing the app runs DatabaseModule.onModuleDestroy, which
    // destroys the shared DataSource (this spec overrides the provider with ctx.dataSource) —
    // teardown after that would see isInitialized=false and silently skip the schema/role drops,
    // leaking tenant_<prefix>_1 schemas. See the ordering rule documented in database.module.ts.
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e3';
  let phoneSeq = 0;

  /** Walks a lab requisition through collect → results → (optionally) verify. */
  async function setupRequisition(phone: string, { verify }: { verify: boolean }) {
    return ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'PDF',
        lastName: 'LabPatient',
        dateOfBirth: '1985-03-10',
        gender: 'Male',
        phoneNumber: phone,
      });
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Lab', itemDescription: 'CBC (PDF export)' }],
      });
      const category = await catalogService.createCategory({ name: 'PDF Category' });
      const test = await catalogService.createTest({
        categoryId: category.id,
        name: 'CBC PDF',
        code: `CBC-PDF-${++phoneSeq}`,
        specimenType: 'Blood',
        price: 150,
      });
      const component = await catalogService.createComponent(test.id, { name: 'Hemoglobin', unit: 'g/dL' });

      const requisition = await labWorkflowService.createRequisition({
        orderItemId: order.items[0].id,
        testId: test.id,
        specimenType: 'Blood',
      });
      await labWorkflowService.collectSample(requisition.id);
      // enteredBy is NOT NULL and no accountId is active outside the HTTP path, so pass the
      // fallback actor explicitly (resolveActor prefers the authenticated principal when set).
      await labWorkflowService.enterResult(requisition.id, {
        componentId: component.id,
        value: '13.2',
        enteredBy: DOCTOR_ID,
      });
      if (verify) {
        await labWorkflowService.verify(requisition.id);
      }
      return requisition;
    });
  }

  it('exports a Verified report as application/pdf starting with the PDF magic bytes', async () => {
    const requisition = await setupRequisition('4450000221', { verify: true });

    const response = await request(app.getHttpServer())
      .get(`/api/lab/requisitions/${requisition.id}/report.pdf`)
      .set('Authorization', `Bearer ${labToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(response.body.length).toBeGreaterThan(500);
  });

  it('rejects PDF export while the requisition is still in a non-terminal status', async () => {
    const requisition = await setupRequisition('4450000222', { verify: false });

    const response = await request(app.getHttpServer())
      .get(`/api/lab/requisitions/${requisition.id}/report.pdf`)
      .set('Authorization', `Bearer ${labToken}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/Report is only available for Verified requisitions/);
  });
});
