import { PdfService } from '@hospital/pdf';
import { toCsv, escapeCsvField } from './reporting-csv.util.js';
import { ReportingQueryService } from './reporting-query.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('reporting CSV export', () => {
  let ctx: TenantTestContext;
  let reportingQueryService: ReportingQueryService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'reporting_csv' });
    reportingQueryService = new ReportingQueryService(ctx.tenantConnection, new PdfService());
  });

  afterAll(() => teardownTenantTestContext(ctx));

  describe('escapeCsvField / toCsv (pure)', () => {
    it('leaves plain fields untouched and quotes fields with commas, quotes, or newlines', () => {
      expect(escapeCsvField('plain')).toBe('plain');
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(123)).toBe('123');
      expect(escapeCsvField('with,comma')).toBe('"with,comma"');
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
      expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
    });

    it('emits a header row plus CRLF-terminated data rows', () => {
      const csv = toCsv(
        [
          { a: 1, b: 'x,y' },
          { a: 2, b: 'z' },
        ],
        ['a', 'b'],
      );
      expect(csv).toBe('a,b\r\n1,"x,y"\r\n2,z\r\n');
    });
  });

  describe('export methods (integration)', () => {
    async function insertEvent(eventType: string, entityId: string, payload: Record<string, unknown>, occurredAt: Date) {
      await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema(async (manager) => {
          await manager.getRepository(ReportingEvent).save(
            manager.getRepository(ReportingEvent).create({
              eventType,
              entityId,
              payload,
              occurredAt,
              correlationId: 'csv-test',
            }),
          );
        }),
      );
    }

    it('exports the events archive as CSV with headers and escaped payloads', async () => {
      await insertEvent('OrderPlaced', '00000000-0000-4000-8000-0000000000aa', { amount: 100, note: 'a,b' }, new Date('2025-01-02T03:04:05Z'));
      await insertEvent('PaymentRecorded', '00000000-0000-4000-8000-0000000000bb', { amount: 250 }, new Date('2025-01-03T00:00:00Z'));

      const csv = await ctx.inTenant(() =>
        reportingQueryService.exportEventsCsv({ from: '2025-01-01', to: '2025-12-31' }),
      );
      const lines = csv.trim().split('\r\n');
      expect(lines[0]).toBe('id,occurredAt,eventType,entityId,correlationId,payload');
      expect(lines).toHaveLength(3); // header + 2 events
      expect(csv).toContain('OrderPlaced');
      expect(csv).toContain('PaymentRecorded');
      // The JSON payload cell must be quoted with embedded quotes doubled (RFC 4180) — key order
      // is jsonb-normalized (sorted), so assert on the escaped fragments, not the whole cell.
      expect(csv).toContain('""note"":""a,b""');
    });

    it('exports the revenue aggregates as CSV', async () => {
      await insertEvent('PaymentRecorded', '00000000-0000-4000-8000-0000000000cc', { amount: 300.5 }, new Date('2025-02-01T00:00:00Z'));

      const csv = await ctx.inTenant(() => reportingQueryService.exportRevenueCsv({ from: '2025-01-01', to: '2025-12-31' }));
      expect(csv).toContain('date,totalAmount');
      expect(csv).toContain('2025-02-01,300.5');
    });

    it('is tenant-isolated', async () => {
      const tenantB = await ctx.createTenant();
      const csv = await tenantB.inTenant(() => reportingQueryService.exportEventsCsv({}));
      expect(csv.trim().split('\r\n')).toHaveLength(1); // header only
    });
  });
});
