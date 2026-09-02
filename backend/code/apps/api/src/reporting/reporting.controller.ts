import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { ReportingQueryService } from './reporting-query.service.js';
import { DateRangeQueryDto, ListEventsQueryDto } from './dto/reporting-query.dto.js';

const REQUIRED_PERMISSION = 'reporting.read';

@Controller('reporting')
@UseGuards(PermissionGuard)
export class ReportingController {
  constructor(private readonly reportingQueryService: ReportingQueryService) {}

  @Get('events')
  @RequirePermission(REQUIRED_PERMISSION)
  async listEvents(@Query() query: ListEventsQueryDto) {
    // paginate() (via the shared DTO's coercion) clamps page/limit exactly as the old manual
    // parse did, and returns the shared { data, meta } contract instead of the divergent
    // { items, total } shape.
    return this.reportingQueryService.listEvents(query);
  }

  @Get('dashboard/event-counts')
  @RequirePermission(REQUIRED_PERMISSION)
  async getEventCounts(@Query() query: DateRangeQueryDto) {
    return this.reportingQueryService.getEventCounts(query);
  }

  @Get('dashboard/revenue')
  @RequirePermission(REQUIRED_PERMISSION)
  async getRevenue(@Query() query: DateRangeQueryDto) {
    return this.reportingQueryService.getRevenue(query);
  }

  @Get('events/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="reporting-events.csv"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportEvents(@Query() query: ListEventsQueryDto) {
    return this.reportingQueryService.exportEventsCsv(query);
  }

  @Get('dashboard/revenue/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="revenue.csv"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportRevenue(@Query() query: DateRangeQueryDto) {
    return this.reportingQueryService.exportRevenueCsv(query);
  }

  @Get('events/export.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="reporting-events.pdf"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportEventsPdf(@Query() query: ListEventsQueryDto): Promise<StreamableFile> {
    const buffer = await this.reportingQueryService.exportEventsPdf(query);
    return new StreamableFile(buffer);
  }

  @Get('events/export.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="reporting-events.xlsx"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportEventsExcel(@Query() query: ListEventsQueryDto): Promise<StreamableFile> {
    const buffer = await this.reportingQueryService.exportEventsExcel(query);
    return new StreamableFile(buffer);
  }

  @Get('dashboard/revenue/export.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="revenue.xlsx"')
  @RequirePermission(REQUIRED_PERMISSION)
  async exportRevenueExcel(@Query() query: DateRangeQueryDto): Promise<StreamableFile> {
    const buffer = await this.reportingQueryService.exportRevenueExcel(query);
    return new StreamableFile(buffer);
  }
}
