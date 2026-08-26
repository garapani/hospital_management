import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AUDIT_EVENT_PUBLISHER, AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { LabModule } from './lab.module.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabWorkflowService } from './lab-workflow.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsModule } from '../patients/patients.module.js';
import { PatientsService } from '../patients/patients.service.js';
import { AuditModule } from '../audit/audit.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
} from '../testing/tenant-test-context.js';

// Regression coverage for code-review-findings-2026-08-25's lab P1: enterResult used to write
// via a raw INSERT ... ON CONFLICT upsert, which bypasses TypeORM's repository layer entirely —
// AuditSubscriber only fires on afterInsert/afterUpdate, so a result being entered or silently
// overwritten left no audit trail. This boots the real DI graph (LabModule + AuditModule) rather
// than instantiating LabWorkflowService directly, since the audit subscriber is wired via
// AuditWiringService.onModuleInit — a bare `new LabWorkflowService(...)` never registers it.
describe('Lab result audit wiring (integration)', () => {
  it('publishes create and update audit events for lab_results, including on a result overwrite', async () => {
    const published: AuditEvent[] = [];
    const testPublisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const ctx = await setupTenantTestContext({ namePrefix: 'lab_audit_wiring' });

    const moduleRef = await Test.createTestingModule({
      imports: [LabModule, OrdersModule, PatientsModule, AuditModule],
    })
      .overrideProvider(AUDIT_EVENT_PUBLISHER)
      .useValue(testPublisher)
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .overrideProvider(TenantContextService)
      .useValue(ctx.tenantContext)
      .compile();
    await moduleRef.init();

    const catalogService = moduleRef.get(LabCatalogService);
    const labWorkflowService = moduleRef.get(LabWorkflowService);
    const ordersService = moduleRef.get(OrdersService);
    const patientsService = moduleRef.get(PatientsService);

    const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';
    const withActor = <T>(work: () => Promise<T>): Promise<T> =>
      ctx.tenantContext.run(
        { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'lab-audit-test' },
        work,
      );

    const { requisitionId, componentId } = await withActor(async () => {
      const category = await catalogService.createCategory({ name: 'Audit Wiring Category' });
      const test = await catalogService.createTest({
        categoryId: category.id,
        name: 'Audit Wiring Test',
        code: 'AUDIT-WIRE-1',
        specimenType: 'Blood',
      });
      const component = await catalogService.createComponent(test.id, { name: 'Component 1' });
      const patient = await patientsService.create({
        firstName: 'Audit',
        lastName: 'Wiring',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '4460000001',
      });
      const order = await ordersService.create({
        patientId: patient.id,
        orderedBy: '00000000-0000-0000-0000-0000000000d1',
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      });
      const requisition = await labWorkflowService.createRequisition({
        orderItemId: order.items[0].id,
        testId: test.id,
        specimenType: 'Blood',
      });
      await labWorkflowService.collectSample(requisition.id);
      return { requisitionId: requisition.id, componentId: component.id };
    });

    await withActor(() => labWorkflowService.enterResult(requisitionId, { componentId, value: '12.5' }));
    await withActor(() => labWorkflowService.enterResult(requisitionId, { componentId, value: '13.1' }));

    const resultEvents = published.filter((event) => event.tableName === 'lab_results');
    expect(resultEvents.some((event) => event.action === 'create')).toBe(true);
    expect(resultEvents.some((event) => event.action === 'update')).toBe(true);
    const updateEvent = resultEvents.find((event) => event.action === 'update');
    expect(updateEvent?.diff.some((entry) => entry.field === 'value')).toBe(true);

    await teardownTenantTestContext(ctx);
    await moduleRef.close();
  });
});
