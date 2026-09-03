import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cashier shift open/close + day-end cash/UPI/card reconciliation — billing-desk staff handling
 * physical cash across an 8-hour shift previously had no way to declare a float, tie payments to
 * their shift, or reconcile a closing cash count against what the system recorded (see
 * pending-tasks.md's "Cashier shift open/close + day-end reconciliation").
 *
 * `payments.shiftId` is nullable and additive — a payment recorded with no open shift is simply
 * untagged, not rejected (shift tracking is optional, not a precondition for billing to work).
 */
export class CreateCashierShifts3000000000005 implements MigrationInterface {
  name = 'CreateCashierShifts3000000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cashier_shifts (
          id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
          "openedBy" character varying NOT NULL,
          "openedAt" timestamp with time zone NOT NULL,
          "floatAmount" numeric(12,2) NOT NULL,
          status character varying(20) DEFAULT 'Open' NOT NULL,
          "closedBy" character varying,
          "closedAt" timestamp with time zone,
          "cashDenominationCounts" jsonb,
          "cashDeclaredTotal" numeric(12,2),
          "modeDeclaredTotals" jsonb,
          notes text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedBy" character varying
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_cashier_shifts_openedBy_status" ON cashier_shifts USING btree ("openedBy", status)`,
    );
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN "shiftId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_shiftId" ON payments USING btree ("shiftId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN "shiftId"`);
    await queryRunner.query(`DROP TABLE cashier_shifts`);
  }
}
