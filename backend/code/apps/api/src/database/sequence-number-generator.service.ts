import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from './tenant-connection.service.js';

const SAFE_TABLE_NAME = /^[a-z_]+$/;

/**
 * Shared implementation behind every per-domain "next number" generator (Patients, Lab, Radiology,
 * Pharmacy, Inventory's purchase-order and stock-requisition sequences) — each domain's own
 * generator class stays a thin wrapper naming its own sequence table and default prefix, so
 * callers and DI wiring keep their existing class/method names unchanged.
 */
@Injectable()
export class SequenceNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNext(sequenceTable: string, prefix: string): Promise<string> {
    if (!SAFE_TABLE_NAME.test(sequenceTable)) {
      throw new Error(`Refusing to use unsafe sequence table name: ${sequenceTable}`);
    }
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO "${sequenceTable}" (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = "${sequenceTable}"."lastSequence" + 1
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
