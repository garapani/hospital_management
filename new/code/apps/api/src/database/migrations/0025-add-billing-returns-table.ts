import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingReturnsTable0025 implements MigrationInterface {
  name = 'AddBillingReturnsTable00252000000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE returns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" uuid NOT NULL,
        amount numeric(12,2) NOT NULL,
        reason text NOT NULL,
        "returnedBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_returns_invoice_id" ON returns ("invoiceId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE returns`);
  }
}
