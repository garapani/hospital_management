import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * India GST place-of-supply support (pending-tasks.md's "Full India GST model" item, new-features.md
 * #20 — this covers the IGST/place-of-supply slice of it, not HSN/SAC-driven rate lookup, which
 * `invoice_items.hsnSacCode` already carries as caller-supplied data with no rate-table behind it
 * yet). GST law splits tax into CGST+SGST for an intra-state supply, or IGST alone (no CGST/SGST)
 * for an inter-state one — same total rate either way, just a different allocation across the three
 * ledger buckets, determined by comparing the hospital's registered state
 * (`billing_settings.stateCode`, already existed) against the patient's (new
 * `patient_addresses.stateCode` — mirrors `billing_settings.stateCode`'s shape: a 2-digit GST state
 * code, not the existing free-text `state` column, which isn't reliably compact-comparable).
 *
 * `invoices.isInterStateSupply` snapshots the determination at invoice-creation time rather than
 * recomputing it per line: a charge-capture invoice can accumulate lines from several separate
 * completions over its `Unpaid`/`PartiallyPaid` lifetime (postChargeCapture appends to whatever
 * open invoice already exists for the patient), and a patient's on-file address can change in
 * between — without a snapshot, a single invoice could end up with some lines taxed CGST+SGST and
 * others IGST, which is not a valid GST document (one invoice has exactly one place of supply).
 */
export class AddGstStateFields3000000000009 implements MigrationInterface {
  name = 'AddGstStateFields3000000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE patient_addresses ADD COLUMN "stateCode" character varying(2)`);
    await queryRunner.query(
      `ALTER TABLE invoice_items ADD COLUMN "igstAmount" numeric(12,2) DEFAULT 0 NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE invoices ADD COLUMN "isInterStateSupply" boolean DEFAULT false NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE invoices DROP COLUMN "isInterStateSupply"`);
    await queryRunner.query(`ALTER TABLE invoice_items DROP COLUMN "igstAmount"`);
    await queryRunner.query(`ALTER TABLE patient_addresses DROP COLUMN "stateCode"`);
  }
}
