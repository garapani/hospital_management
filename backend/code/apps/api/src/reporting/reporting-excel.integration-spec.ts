import ExcelJS from 'exceljs';
import { PdfService } from '@hospital/pdf';
import { ExcelService } from '@hospital/excel';
import { ReportingQueryService } from './reporting-query.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

describe('reporting Excel export (integration)', () => {
  let ctx: TenantTestContext;
  let reportingQueryService: ReportingQueryService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'reporting_excel' });
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
            correlationId: 'excel-test',
          }),
        );
      }),
    );
  }

  it('exports the events archive as a valid .xlsx workbook', async () => {
    await insertEvent('OrderPlaced', '00000000-0000-4000-8000-0000000000aa', { amount: 100 }, new Date('2025-01-02T03:04:05Z'));
    await insertEvent('PaymentRecorded', '00000000-0000-4000-8000-0000000000bb', { amount: 250 }, new Date('2025-01-03T00:00:00Z'));

    const buffer = await ctx.inTenant(() =>
      reportingQueryService.exportEventsExcel({ from: '2025-01-01', to: '2025-12-31' }),
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Events');

    expect(sheet).toBeDefined();
    // exceljs's Row.values is 1-indexed (index 0 is always undefined) — drop it before comparing.
    expect((sheet!.getRow(1).values as unknown[]).slice(1)).toEqual([
      'ID',
      'Occurred At',
      'Event Type',
      'Entity ID',
      'Correlation ID',
      'Payload',
    ]);
    expect(sheet!.rowCount).toBe(3); // header + 2 events
    const eventTypes = [sheet!.getRow(2).getCell(3).value, sheet!.getRow(3).getCell(3).value];
    expect(eventTypes).toEqual(expect.arrayContaining(['OrderPlaced', 'PaymentRecorded']));
  });

  it('exports the revenue aggregates as a valid .xlsx workbook', async () => {
    await insertEvent('PaymentRecorded', '00000000-0000-4000-8000-0000000000cc', { amount: 300.5 }, new Date('2025-02-01T00:00:00Z'));

    const buffer = await ctx.inTenant(() =>
      reportingQueryService.exportRevenueExcel({ from: '2025-01-01', to: '2025-12-31' }),
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Revenue');

    expect(sheet).toBeDefined();
    expect((sheet!.getRow(1).values as unknown[]).slice(1)).toEqual(['Date', 'Total Amount']);
    // Earlier tests in this describe block share ctx's tenant schema, so other dated rows may
    // also be present — assert this row exists rather than assuming a fixed row index.
    const rows: [unknown, unknown][] = [];
    sheet!.eachRow((row, rowNumber) => {
      if (rowNumber > 1) rows.push([row.getCell(1).value, row.getCell(2).value]);
    });
    expect(rows).toContainEqual(['2025-02-01', 300.5]);
  });

  it('is tenant-isolated', async () => {
    const tenantB = await ctx.createTenant();
    const buffer = await tenantB.inTenant(() => reportingQueryService.exportEventsExcel({}));
    const workbook = await loadWorkbook(buffer);
    expect(workbook.getWorksheet('Events')!.rowCount).toBe(1); // header only
  });
});
