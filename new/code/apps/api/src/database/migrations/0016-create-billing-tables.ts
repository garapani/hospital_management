import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingTables0016 implements MigrationInterface {
  name = 'CreateBillingTables0016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE billing_settings (
        id varchar(20) PRIMARY KEY,
        gstin varchar(15) NOT NULL,
        "stateCode" varchar(2) NOT NULL,
        "hospitalLegalName" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE billing_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "sourceAppointmentId" uuid NULL,
        "sourceAdmissionId" uuid NULL,
        "invoiceNumber" integer NOT NULL,
        "financialYear" varchar(10) NOT NULL,
        subtotal numeric(12,2) NOT NULL,
        "discountAmount" numeric(12,2) NOT NULL,
        "taxableAmount" numeric(12,2) NOT NULL,
        "taxAmount" numeric(12,2) NOT NULL,
        "totalAmount" numeric(12,2) NOT NULL,
        "paidAmount" numeric(12,2) NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT 'Unpaid',
        notes text NULL,
        "createdBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_invoices_patient_id" ON invoices ("patientId")`);
    await queryRunner.query(
      `ALTER TABLE invoices ADD CONSTRAINT "UQ_invoices_number_fy" UNIQUE ("financialYear", "invoiceNumber")`,
    );
    await queryRunner.query(`
      CREATE TABLE invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" uuid NOT NULL,
        "sourceOrderItemId" uuid NULL,
        description text NOT NULL,
        "hsnSacCode" varchar(20) NULL,
        quantity numeric(10,2) NOT NULL DEFAULT 1,
        "unitPrice" numeric(12,2) NOT NULL,
        "discountAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "taxPercent" numeric(5,2) NOT NULL DEFAULT 0,
        "cgstAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "sgstAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "totalAmount" numeric(12,2) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_invoice_items_invoice_id" ON invoice_items ("invoiceId")`);
    await queryRunner.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" uuid NOT NULL,
        amount numeric(12,2) NOT NULL,
        "paymentMode" varchar(20) NOT NULL,
        "sourceDepositId" uuid NULL,
        "receivedBy" uuid NOT NULL,
        "receivedAt" timestamptz NOT NULL DEFAULT now(),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_invoice_id" ON payments ("invoiceId")`);
    await queryRunner.query(`
      CREATE TABLE deposits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        amount numeric(12,2) NOT NULL,
        balance numeric(12,2) NOT NULL,
        "receivedBy" uuid NOT NULL,
        "receivedAt" timestamptz NOT NULL DEFAULT now(),
        notes text NULL,
        "refundedBy" uuid NULL,
        "refundedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_deposits_patient_id" ON deposits ("patientId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE deposits`);
    await queryRunner.query(`DROP TABLE payments`);
    await queryRunner.query(`DROP TABLE invoice_items`);
    await queryRunner.query(`DROP TABLE invoices`);
    await queryRunner.query(`DROP TABLE billing_sequences`);
    await queryRunner.query(`DROP TABLE billing_settings`);
  }
}
