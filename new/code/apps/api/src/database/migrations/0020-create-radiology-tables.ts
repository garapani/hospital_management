import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRadiologyTables0020 implements MigrationInterface {
  name = 'CreateRadiologyTables00202000000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE radiology_imaging_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "procedureCoding" varchar NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE radiology_imaging_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "imagingTypeId" uuid NOT NULL,
        name varchar NOT NULL,
        "procedureCode" varchar NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_radiology_imaging_items_imaging_type_id" ON radiology_imaging_items ("imagingTypeId")`,
    );
    await queryRunner.query(`
      CREATE TABLE radiology_requisitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderItemId" uuid NOT NULL,
        "imagingItemId" uuid NOT NULL,
        "requisitionNumber" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "scannedBy" uuid NULL,
        "scannedAt" timestamptz NULL,
        "reportText" text NULL,
        indication text NULL,
        "performerId" uuid NULL,
        "reportEnteredBy" uuid NULL,
        "reportEnteredAt" timestamptz NULL,
        "verifiedBy" uuid NULL,
        "verifiedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_radiology_requisitions_requisition_number" UNIQUE ("requisitionNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_radiology_requisitions_order_item_id" ON radiology_requisitions ("orderItemId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_radiology_requisitions_active_order_item"
      ON radiology_requisitions ("orderItemId")
      WHERE status <> 'Cancelled'
    `);
    await queryRunner.query(`
      CREATE TABLE radiology_requisition_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE radiology_requisition_sequences`);
    await queryRunner.query(`DROP INDEX "UQ_radiology_requisitions_active_order_item"`);
    await queryRunner.query(`DROP TABLE radiology_requisitions`);
    await queryRunner.query(`DROP TABLE radiology_imaging_items`);
    await queryRunner.query(`DROP TABLE radiology_imaging_types`);
  }
}
