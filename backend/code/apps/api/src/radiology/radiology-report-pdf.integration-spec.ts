import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { RadiologyModule } from './radiology.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
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

describe('Radiology report PDF export (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let radiologyToken: string;

  let catalogService: RadiologyCatalogService;
  let workflowService: RadiologyWorkflowService;
  let ordersService: OrdersService;
  let patientsService: PatientsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'radiology_report_pdf' });

    radiologyToken = await signTestToken({
      sub: 'radiology-report-reader',
      hospitalId: ctx.tenantId,
      permissions: ['radiology.read'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, RadiologyModule] })
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

    catalogService = new RadiologyCatalogService(ctx.tenantConnection);
    ordersService = new OrdersService(ctx.tenantConnection);
    workflowService = new RadiologyWorkflowService(
      ctx.tenantConnection,
      new RadiologyRequisitionNumberGeneratorService(ctx.tenantConnection),
      catalogService,
      ordersService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
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

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e4';

  /** Walks a radiology requisition through scanned → report entered → (optionally) verify. */
  async function setupRequisition(phone: string, { verify }: { verify: boolean }) {
    return ctx.inTenant(async () => {
      const patient = await patientsService.create({
        firstName: 'PDF',
        lastName: 'RadPatient',
        dateOfBirth: '1978-11-02',
        gender: 'Female',
        phoneNumber: phone,
      });
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: DOCTOR_ID,
        items: [{ itemType: 'Radiology', itemDescription: 'Chest X-Ray (PDF export)' }],
      });
      const type = await catalogService.createType({ name: 'X-Ray' });
      const item = await catalogService.createItem({
        imagingTypeId: type.id,
        name: 'Chest X-Ray PA',
        procedureCode: 'XR-CHEST',
        price: 500,
      });

      const requisition = await workflowService.createRequisition({
        orderItemId: order.items[0].id,
        imagingItemId: item.id,
      });
      // scannedBy/reportEnteredBy/verifiedBy are set via resolveActor (authenticated principal
      // wins); outside the HTTP path no accountId is active, so pass explicit fallbacks.
      await workflowService.markScanned(requisition.id, DOCTOR_ID);
      await workflowService.enterReport(requisition.id, {
        reportText: 'No acute cardiopulmonary abnormality.',
        indication: 'Persistent cough',
        reportEnteredBy: DOCTOR_ID,
      });
      if (verify) {
        await workflowService.verify(requisition.id, DOCTOR_ID);
      }
      return requisition;
    });
  }

  it('exports a Verified report as application/pdf starting with the PDF magic bytes', async () => {
    const requisition = await setupRequisition('4450000331', { verify: true });

    const response = await request(app.getHttpServer())
      .get(`/api/radiology/requisitions/${requisition.id}/report.pdf`)
      .set('Authorization', `Bearer ${radiologyToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(response.body.length).toBeGreaterThan(500);
  });

  it('rejects PDF export while the requisition is still in a non-terminal status', async () => {
    const requisition = await setupRequisition('4450000332', { verify: false });

    const response = await request(app.getHttpServer())
      .get(`/api/radiology/requisitions/${requisition.id}/report.pdf`)
      .set('Authorization', `Bearer ${radiologyToken}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/Report is only available for Verified requisitions/);
  });
});
