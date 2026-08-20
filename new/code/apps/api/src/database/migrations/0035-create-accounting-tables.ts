import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounting module (PRD Phase 3): chart of accounts, double-entry journal, and read-only
 * financial reports (trial balance / income statement / balance sheet are computed queries).
 */
export class CreateAccountingTables0035 implements MigrationInterface {
  name = 'CreateAccountingTables00352000000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ledger_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "accountCode" varchar NOT NULL,
        name varchar NOT NULL,
        type varchar NOT NULL,
        "parentAccountId" uuid NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE journal_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "journalNumber" varchar NOT NULL UNIQUE,
        "entryDate" date NOT NULL,
        narration text NULL,
        status varchar NOT NULL DEFAULT 'Draft',
        "createdBy" uuid NOT NULL,
        "postedBy" uuid NULL,
        "postedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE journal_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "journalId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        debit numeric(14,2) NOT NULL DEFAULT 0,
        credit numeric(14,2) NOT NULL DEFAULT 0,
        "lineNarration" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE journal_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE journal_sequences`);
    await queryRunner.query(`DROP TABLE journal_lines`);
    await queryRunner.query(`DROP TABLE journal_entries`);
    await queryRunner.query(`DROP TABLE ledger_accounts`);
  }
}
