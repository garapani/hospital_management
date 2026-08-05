import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class RadiologyRequisitionNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextRequisitionNumber(prefix = 'RAD'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO radiology_requisition_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = radiology_requisition_sequences."lastSequence" + 1
        RETURNING "lastSequence"
        `,
        [prefix, currentYear],
      );

      const nextSeq = result[0].lastSequence as number;
      const paddedSeq = String(nextSeq).padStart(5, '0');
      return `${prefix}-${currentYear}-${paddedSeq}`;
    });
  }
}
