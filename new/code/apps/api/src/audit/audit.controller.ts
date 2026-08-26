import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { SearchAuditRecordsDto } from './dto/search-audit-records.dto.js';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PaginatedResponseDto } from '@hospital/pagination';
import { AuditRecord } from './entities/audit-record.entity.js';

@Controller('audit')
@UseGuards(PermissionGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  async search(@Query() query: SearchAuditRecordsDto): Promise<PaginatedResponseDto<AuditRecord>> {
    return this.auditService.getAuditRecords(
      {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        tableName: query.tableName,
        action: query.action,
        changedByAccountId: query.changedByAccountId,
        recordId: query.recordId,
        correlationId: query.correlationId,
      },
      query,
    );
  }
}
