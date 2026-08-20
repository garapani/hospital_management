import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Insurance & Claims module (PRD Phase 3): payer master, patient insurance policies (eligibility
 * window + copay), and a claims lifecycle linked to invoices. PM-JAY/Medicare specifics and
 * external referrals are deferred (PRD §5.7); this is the payer/policy/claim core.
 */
export class CreateInsuranceTables0034 implements MigrationInterface {
  name = 'CreateInsuranceTables00342000000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE insurance_payers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        type varchar NOT NULL,
        "contactPerson" varchar NULL,
        phone varchar NULL,
        address text NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE patient_policies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "payerId" uuid NOT NULL,
        "policyNumber" varchar NOT NULL,
        "insuredName" varchar NULL,
        "relationshipToInsured" varchar NULL,
        "coverageStartDate" date NOT NULL,
        "coverageEndDate" date NOT NULL,
        "sumInsured" numeric(14,2) NOT NULL,
        "copayPercent" numeric(5,2) NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE insurance_claims (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "claimNumber" varchar NOT NULL UNIQUE,
        "patientId" uuid NOT NULL,
        "policyId" uuid NOT NULL,
        "invoiceId" uuid NOT NULL,
        "amountClaimed" numeric(14,2) NOT NULL,
        "amountApproved" numeric(14,2) NULL,
        status varchar NOT NULL DEFAULT 'Draft',
        remarks text NULL,
        "submittedBy" uuid NOT NULL,
        "processedBy" uuid NULL,
        "submittedAt" timestamptz NULL,
        "processedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE insurance_claim_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE insurance_claim_sequences`);
    await queryRunner.query(`DROP TABLE insurance_claims`);
    await queryRunner.query(`DROP TABLE patient_policies`);
    await queryRunner.query(`DROP TABLE insurance_payers`);
  }
}
