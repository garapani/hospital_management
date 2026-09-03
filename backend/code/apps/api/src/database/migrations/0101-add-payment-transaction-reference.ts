import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank reconciliation / finance audit couldn't match a hospital payment record against the
 * corresponding bank-statement line — no field existed for a UPI ref number, cheque number, or
 * card auth code (see pending-tasks.md's "Payment transaction reference fields"). Both nullable —
 * backfills cleanly against every already-provisioned tenant with no default/backfill step needed
 * (matches migration 0095's precedent for an additive, always-optional column).
 */
export class AddPaymentTransactionReference3000000000006 implements MigrationInterface {
  name = 'AddPaymentTransactionReference3000000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE payments ADD COLUMN "transactionReference" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN "bankName" character varying(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN "bankName"`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN "transactionReference"`);
  }
}
