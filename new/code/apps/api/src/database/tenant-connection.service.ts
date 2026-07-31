import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';

const SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;

@Injectable()
export class TenantConnectionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async runInTenantSchema<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const schemaName = this.tenantContext.getSchemaName();
    if (!schemaName) {
      throw new Error('No tenant context set — cannot resolve a schema for this query.');
    }
    if (!SAFE_SCHEMA_NAME.test(schemaName)) {
      throw new Error(`Refusing to use unsafe schema name: ${schemaName}`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`SET search_path TO "${schemaName}", public`);
      return await work(queryRunner.manager);
    } finally {
      await queryRunner.release();
    }
  }
}
