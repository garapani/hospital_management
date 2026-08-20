import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ward Supply module (PRD Phase 2): ward sub-store stock ledger — receives from the central
 * store / fulfilled requisitions, ward consumption, per-department balances.
 */
export class CreateWardSupplyTables0036 implements MigrationInterface {
  name = 'CreateWardSupplyTables00362000000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ward_stock_balances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "availableQuantity" numeric(12,2) NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("departmentId", "itemId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ward_stock_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "transactionType" varchar NOT NULL,
        quantity numeric(12,2) NOT NULL,
        "patientId" uuid NULL,
        "admissionId" uuid NULL,
        "performedBy" uuid NOT NULL,
        "performedAt" timestamptz NOT NULL DEFAULT now(),
        remarks text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ward_stock_transactions`);
    await queryRunner.query(`DROP TABLE ward_stock_balances`);
  }
}
