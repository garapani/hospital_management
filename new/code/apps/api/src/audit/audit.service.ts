import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';
import { Between, FindOptionsWhere } from 'typeorm';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { SearchAuditRecordsDto } from './dto/search-audit-records.dto.js';

export interface AuditRecordFilter {
  startDate?: Date;
  endDate?: Date;
  tableName?: string;
  action?: 'create' | 'update' | 'delete';
  changedByAccountId?: string;
  recordId?: string;
  correlationId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async getAuditRecords(filter: AuditRecordFilter, query: SearchAuditRecordsDto): Promise<PaginatedResponseDto<AuditRecord>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(AuditRecord);

      // Default to last 24h if no dates provided
      const endDate = filter.endDate ?? new Date();
      const startDate = filter.startDate ?? new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      const where: FindOptionsWhere<AuditRecord> = {
        occurredAt: Between(startDate, endDate),
      };

      if (filter.tableName) where.tableName = filter.tableName;
      if (filter.action) where.action = filter.action;
      if (filter.changedByAccountId) where.changedByAccountId = filter.changedByAccountId;
      if (filter.recordId) where.recordId = filter.recordId;
      if (filter.correlationId) where.correlationId = filter.correlationId;

      const qb = repository.createQueryBuilder('audit');
      qb.where(where);
      qb.orderBy('audit.occurredAt', 'DESC');
      
      return paginate(qb, query);
    });
  }
}
