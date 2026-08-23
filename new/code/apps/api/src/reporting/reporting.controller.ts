import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { ReportingQueryService } from './reporting-query.service.js';

const REQUIRED_PERMISSION = 'reporting.read';

@Controller('reporting')
@UseGuards(PermissionGuard)
export class ReportingController {
  constructor(private readonly reportingQueryService: ReportingQueryService) {}

  @Get('events')
  @RequirePermission(REQUIRED_PERMISSION)
  async listEvents(
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page && !isNaN(Number(page)) ? Math.max(1, Number(page)) : 1;
    const parsedLimit = limit && !isNaN(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;
    return this.reportingQueryService.listEvents({
      eventType,
      from,
      to,
      page: parsedPage,
      limit: parsedLimit,
    });
  }

  @Get('dashboard/event-counts')
  @RequirePermission(REQUIRED_PERMISSION)
  async getEventCounts(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportingQueryService.getEventCounts({ from, to });
  }

  @Get('dashboard/revenue')
  @RequirePermission(REQUIRED_PERMISSION)
  async getRevenue(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportingQueryService.getRevenue({ from, to });
  }

  @Get('events/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="reporting-events.csv"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportEvents(
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportingQueryService.exportEventsCsv({ eventType, from, to });
  }

  @Get('dashboard/revenue/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="revenue.csv"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportRevenue(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportingQueryService.exportRevenueCsv({ from, to });
  }

  @Get('events/export.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="reporting-events.pdf"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportEventsPdf(
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<StreamableFile> {
    const buffer = await this.reportingQueryService.exportEventsPdf({ eventType, from, to });
    return new StreamableFile(buffer);
  }
}
