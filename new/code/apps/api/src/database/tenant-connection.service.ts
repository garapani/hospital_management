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

  /**
   * @param dataSourceOverride Optional alternative `DataSource` (i.e. a different connection pool)
   * to take the connection from. Defaults to the main injected `DataSource`. Tenant resolution and
   * schema-name validation are identical either way — the override only changes which pool the
   * connection comes from.
   */
  async runInTenantSchema<T>(
    work: (manager: EntityManager) => Promise<T>,
    dataSourceOverride?: DataSource,
  ): Promise<T> {
    const dataSource = dataSourceOverride ?? this.dataSource;
    const schemaName = this.tenantContext.getSchemaName();
    if (!schemaName) {
      throw new Error('No tenant context set — cannot resolve a schema for this query.');
    }
    if (!SAFE_SCHEMA_NAME.test(schemaName)) {
      throw new Error(`Refusing to use unsafe schema name: ${schemaName}`);
    }

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // SET LOCAL only takes effect inside an explicit transaction — outside one it silently
      // no-ops rather than erroring, which is why startTransaction() above is load-bearing, not
      // optional. Scoping both to the transaction means a pooled connection can never leak an
      // elevated role or the wrong search_path into whatever request reuses it next — both reset
      // automatically when the transaction ends, whether committed or rolled back.
      await queryRunner.query(`SET LOCAL ROLE "${schemaName}"`);
      await queryRunner.query(`SET LOCAL search_path TO "${schemaName}", public`);
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
