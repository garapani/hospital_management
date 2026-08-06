import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryRequisitionTables0023 implements MigrationInterface {
  name = 'CreateInventoryRequisitionTables00232000000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stock_requisitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentId" uuid NOT NULL,
        "requestedBy" uuid NOT NULL,
        "requisitionNumber" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        notes text NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_stock_requisitions_requisition_number" UNIQUE ("requisitionNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_requisitions_department_id" ON stock_requisitions ("departmentId")`,
    );
    await queryRunner.query(`
      CREATE TABLE stock_requisition_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requisitionId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "requestedQuantity" numeric NOT NULL,
        "fulfilledQuantity" numeric NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_requisition_items_requisition_id" ON stock_requisition_items ("requisitionId")`,
    );
    await queryRunner.query(`
      CREATE TABLE stock_requisition_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE stock_requisition_sequences`);
    await queryRunner.query(`DROP TABLE stock_requisition_items`);
    await queryRunner.query(`DROP TABLE stock_requisitions`);
  }
}
