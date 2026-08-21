import { Injectable } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { toCsv } from './reporting-csv.util.js';
import { buildReportingEventsPdfDocument } from './reporting-events-pdf-document.js';

export interface ListEventsParams {
  eventType?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
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

const REVENUE_EVENT_TYPES = ['PaymentRecorded', 'DepositReceived'];

@Injectable()
export class ReportingQueryService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly pdfService: PdfService,
  ) {}

  async listEvents(params: ListEventsParams): Promise<{ items: ReportingEvent[]; total: number }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;

    return this.tenantConnection.runInTenantSchema(async (manager) => {
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

      qb.skip((page - 1) * limit).take(limit);

      const [items, total] = await qb.getManyAndCount();
      return { items, total };
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
        .addSelect(`SUM((e.payload->>'amount')::numeric)`, 'totalAmount')
        .where('e.eventType IN (:...types)', { types: REVENUE_EVENT_TYPES })
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

  /** Whole-set CSV export (capped at 10000 rows) of the events archive matching the filters. */
  async exportEventsCsv(params: ListEventsParams): Promise<string> {
    const { items } = await this.listEvents({ ...params, page: 1, limit: 10000 });
    const columns = ['id', 'occurredAt', 'eventType', 'entityId', 'correlationId', 'payload'];
    return toCsv(
      items.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        eventType: e.eventType,
        entityId: e.entityId,
        correlationId: e.correlationId ?? '',
        payload: JSON.stringify(e.payload),
      })),
      columns,
    );
  }

  /** CSV export of the daily revenue aggregates. */
  async exportRevenueCsv(params: DateRangeParams): Promise<string> {
    const rows = await this.getRevenue(params);
    return toCsv(rows.map((r) => ({ date: r.date, totalAmount: r.totalAmount })), ['date', 'totalAmount']);
  }

  /** Whole-set PDF export (same 10000-row cap as the CSV sibling) of the events archive matching
   *  the filters, via the shared `@hospital/pdf` lib. */
  async exportEventsPdf(params: ListEventsParams): Promise<Buffer> {
    const { items } = await this.listEvents({ ...params, page: 1, limit: 10000 });
    return this.pdfService.render(
      buildReportingEventsPdfDocument({
        rows: items.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt.toISOString(),
          eventType: e.eventType,
          entityId: e.entityId,
          correlationId: e.correlationId ?? '',
          payload: JSON.stringify(e.payload),
        })),
        eventType: params.eventType,
        from: params.from,
        to: params.to,
      }),
    );
  }
}
