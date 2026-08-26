import { Injectable } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { toCsv } from './reporting-csv.util.js';
import { buildReportingEventsPdfDocument } from './reporting-events-pdf-document.js';

export interface ListEventsParams extends PaginationQueryDto {
  eventType?: string;
  from?: string;
  to?: string;
}

export interface DateRangeParams {
  from?: string;
  to?: string;
}

export interface EventCountRow {
  date: string;
  eventType: string;
  count: number;
}

export interface RevenueRow {
  date: string;
  totalAmount: number;
}

// Revenue = money collected through payments minus money returned — the dashboard's old
// "PaymentRecorded + DepositReceived" sum double-counted deposit-funded payments (a deposit
// funds a payment, which fires BOTH events) and ignored refunds entirely
// (code-review-findings-2026-08-25 reporting P2). A deposit is patient money held, not revenue;
// the PaymentRecorded event it eventually funds is the revenue event. InvoiceReturned (the
// `returns` insert, added to the reporting subscriber) subtracts.
const REVENUE_POSITIVE_EVENT_TYPES = ['PaymentRecorded'];
const REVENUE_NEGATIVE_EVENT_TYPES = ['InvoiceReturned'];

@Injectable()
export class ReportingQueryService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly pdfService: PdfService,
  ) {}

  async listEvents(params: ListEventsParams): Promise<PaginatedResponseDto<ReportingEvent>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.createQueryBuilder(ReportingEvent, 'e').orderBy('e.occurredAt', 'DESC');

      if (params.eventType) {
        qb.andWhere('e.eventType = :eventType', { eventType: params.eventType });
      }
      if (params.from) {
        qb.andWhere('e.occurredAt >= :from', { from: params.from });
      }
      if (params.to) {
        qb.andWhere('e.occurredAt <= :to', { to: params.to });
      }

      // Shared pagination contract ({ data, meta }) — reporting previously hand-rolled a
      // divergent { items, total } shape (code-review-findings-2026-08-25 reporting P2).
      return paginate(qb, params);
    });
  }

  async getEventCounts(params: DateRangeParams): Promise<EventCountRow[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(ReportingEvent, 'e')
        .select(`date_trunc('day', e.occurredAt)`, 'date')
        .addSelect('e.eventType', 'eventType')
        .addSelect('COUNT(*)', 'count')
        .groupBy(`date_trunc('day', e.occurredAt)`)
        .addGroupBy('e.eventType')
        .orderBy('date', 'ASC');

      if (params.from) {
        qb.andWhere('e.occurredAt >= :from', { from: params.from });
      }
      if (params.to) {
        qb.andWhere('e.occurredAt <= :to', { to: params.to });
      }

      const rows = await qb.getRawMany<{ date: Date; eventType: string; count: string }>();
      return rows.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        eventType: row.eventType,
        count: Number(row.count),
      }));
    });
  }

  async getRevenue(params: DateRangeParams): Promise<RevenueRow[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(ReportingEvent, 'e')
        .select(`date_trunc('day', e.occurredAt)`, 'date')
        // PaymentRecorded adds, InvoiceReturned subtracts — one pass, net revenue per day
        // (the old query summed both event types as positive, double-counting deposits and
        // ignoring refunds; reporting P2).
        .addSelect(
          `SUM(CASE WHEN e.eventType = 'PaymentRecorded'
               THEN (e.payload->>'amount')::numeric
               ELSE -((e.payload->>'amount')::numeric) END)`,
          'totalAmount',
        )
        .where('e.eventType IN (:...types)', {
          types: [...REVENUE_POSITIVE_EVENT_TYPES, ...REVENUE_NEGATIVE_EVENT_TYPES],
        })
        .groupBy(`date_trunc('day', e.occurredAt)`)
        .orderBy('date', 'ASC');

      if (params.from) {
        qb.andWhere('e.occurredAt >= :from', { from: params.from });
      }
      if (params.to) {
        qb.andWhere('e.occurredAt <= :to', { to: params.to });
      }

      const rows = await qb.getRawMany<{ date: Date; totalAmount: string | null }>();
      return rows.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        totalAmount: Number(row.totalAmount ?? 0),
      }));
    });
  }

  private mapEventToExportRow(e: ReportingEvent) {
    return {
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      eventType: e.eventType,
      entityId: e.entityId,
      correlationId: e.correlationId ?? '',
      payload: JSON.stringify(e.payload),
    };
  }

  /** Whole-set CSV export (capped at 10000 rows — the cap is what bounds the in-memory
   *  materialization; true response streaming is a larger response-layer feature, per the
   *  findings note) of the events archive matching the filters. */
  async exportEventsCsv(params: ListEventsParams): Promise<string> {
    const { data } = await this.listEvents({ ...params, page: 1, limit: 10000 });
    const columns = ['id', 'occurredAt', 'eventType', 'entityId', 'correlationId', 'payload'];
    return toCsv(data.map((e) => this.mapEventToExportRow(e)), columns);
  }

  /** CSV export of the daily revenue aggregates. */
  async exportRevenueCsv(params: DateRangeParams): Promise<string> {
    const rows = await this.getRevenue(params);
    return toCsv(rows.map((r) => ({ date: r.date, totalAmount: r.totalAmount })), ['date', 'totalAmount']);
  }

  /** Whole-set PDF export (capped at 500 rows to prevent event-loop blocking) of the events archive matching
   *  the filters, via the shared `@hospital/pdf` lib. */
  async exportEventsPdf(params: ListEventsParams): Promise<Buffer> {
    const { data, meta } = await this.listEvents({ ...params, page: 1, limit: 500 });
    return this.pdfService.render(
      buildReportingEventsPdfDocument({
        rows: data.map((e) => this.mapEventToExportRow(e)),
        totalMatching: meta.total,
        eventType: params.eventType,
        from: params.from,
        to: params.to,
      }),
    );
  }
}
