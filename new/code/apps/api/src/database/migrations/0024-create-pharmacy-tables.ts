import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePharmacyTables0024 implements MigrationInterface {
  name = 'CreatePharmacyTables00242000000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pharmacy_dispensings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderItemId" uuid NOT NULL,
        "inventoryItemId" uuid NOT NULL,
        "dispensingNumber" varchar NOT NULL,
        quantity numeric NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "dispensedBy" uuid NULL,
        "dispensedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_pharmacy_dispensings_dispensing_number" UNIQUE ("dispensingNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_pharmacy_dispensings_order_item_id" ON pharmacy_dispensings ("orderItemId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pharmacy_dispensings_active_order_item"
      ON pharmacy_dispensings ("orderItemId")
      WHERE status <> 'Cancelled'
    `);
    await queryRunner.query(`
      CREATE TABLE pharmacy_dispensing_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE pharmacy_dispensing_sequences`);
    await queryRunner.query(`DROP INDEX "UQ_pharmacy_dispensings_active_order_item"`);
    await queryRunner.query(`DROP TABLE pharmacy_dispensings`);
  }
}
