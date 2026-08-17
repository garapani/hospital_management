import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `department_catalog` table backing DepartmentCatalog (master-data/entities/
 * department-catalog.entity.ts), referenced since it was added on 2026-08-12 but never actually
 * migrated — every call to listDepartmentCatalogs()/createDepartmentCatalog() (and
 * tenants.service.ts's use of the same entity to seed a new tenant's departments from the
 * platform catalog) has been failing with a Postgres "relation does not exist" error. Discovered
 * while adding integration test coverage for the platform-altitude split of master-data.service.ts
 * on 2026-08-17. Platform-schema (shared, not per-tenant), matching how the service queries it via
 * a raw DataSource repository rather than TenantConnectionService.runInTenantSchema.
 */
export class CreateDepartmentCatalogTable0029 implements MigrationInterface {
  name = 'CreateDepartmentCatalogTable1000000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "department_catalog" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "departmentCode" character varying NOT NULL,
        "departmentName" character varying NOT NULL,
        "description" character varying,
        "isActive" boolean NOT NULL DEFAULT true,
        "isAppointmentApplicable" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_department_catalog_departmentCode" UNIQUE ("departmentCode"),
        CONSTRAINT "PK_department_catalog" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "department_catalog"`);
  }
}
