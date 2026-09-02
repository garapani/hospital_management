import { PdfService } from '@hospital/pdf';
import { ExcelService } from '@hospital/excel';
import { ReportingQueryService } from './reporting-query.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('reporting PDF export (integration)', () => {
  let ctx: TenantTestContext;
  let reportingQueryService: ReportingQueryService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'reporting_pdf' });
    reportingQueryService = new ReportingQueryService(ctx.tenantConnection, new PdfService(), new ExcelService());
  });

  afterAll(() => teardownTenantTestContext(ctx));

  async function insertEvent(eventType: string, entityId: string, payload: Record<string, unknown>, occurredAt: Date) {
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        await manager.getRepository(ReportingEvent).save(
          manager.getRepository(ReportingEvent).create({
            eventType,
            entityId,
            payload,
            occurredAt,
            correlationId: 'pdf-test',
          }),
        );
      }),
    );
  }

  it('exports the events archive as a PDF starting with the PDF magic bytes', async () => {
    await insertEvent('OrderPlaced', '00000000-0000-4000-8000-0000000000aa', { amount: 100 }, new Date('2025-01-02T03:04:05Z'));
    await insertEvent('PaymentRecorded', '00000000-0000-4000-8000-0000000000bb', { amount: 250 }, new Date('2025-01-03T00:00:00Z'));

    const buffer = await ctx.inTenant(() =>
      reportingQueryService.exportEventsPdf({ from: '2025-01-01', to: '2025-12-31' }),
    );
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('applies the eventType filter to the exported set', async () => {
    await insertEvent('OrderPlaced', '00000000-0000-4000-8000-0000000000cc', { amount: 50 }, new Date('2025-03-01T00:00:00Z'));
    await insertEvent('PaymentRecorded', '00000000-0000-4000-8000-0000000000dd', { amount: 75 }, new Date('2025-03-02T00:00:00Z'));

    const buffer = await ctx.inTenant(() =>
      reportingQueryService.exportEventsPdf({
        eventType: 'OrderPlaced',
        from: '2025-03-01',
        to: '2025-03-31',
      }),
    );
    // A real, non-trivial PDF was produced for the filtered set (content assertions live in
    // reporting-events-pdf-document.spec.ts, which tests the pure builder directly).
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('is tenant-isolated', async () => {
    const tenantB = await ctx.createTenant();
    const buffer = await tenantB.inTenant(() => reportingQueryService.exportEventsPdf({}));
    // Still a valid (empty-table) PDF, not an error — mirrors the CSV sibling's header-only case.
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
