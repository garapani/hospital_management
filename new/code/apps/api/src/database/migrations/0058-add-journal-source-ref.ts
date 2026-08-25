import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a source reference to journal_entries so an automatically-posted journal (billing payment,
 * deposit, return, charge-capture revenue) can be traced back to the record that caused it, and so
 * posting is idempotent: AccountingService.postAutoJournal looks up an existing journal by
 * (sourceType, sourceId) before inserting a new one. The partial unique index only applies to rows
 * that set sourceType — manually-created journals (via POST /accounting/journals) leave both null
 * and are unaffected.
 */
export class AddJournalSourceRef3000000000058 implements MigrationInterface {
  // Sort key intentionally 3xxx: TypeORM sorts migrations by parsing the LAST 13 characters of
  // `name` as a timestamp, not by array position or filename (see the migration-safety-check
  // skill). This ALTERs journal_entries, created by CreateAccountingTables0035 whose sort key is
  // "2000000000035" — 3000000000058 sorts after it and after every other existing migration.
  name = 'AddJournalSourceRef3000000000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS "sourceType" varchar(40)`);
    await queryRunner.query(`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS "sourceId" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_journal_entries_source" ON journal_entries ("sourceType", "sourceId") WHERE "sourceType" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_journal_entries_source"`);
    await queryRunner.query(`ALTER TABLE journal_entries DROP COLUMN IF EXISTS "sourceId"`);
    await queryRunner.query(`ALTER TABLE journal_entries DROP COLUMN IF EXISTS "sourceType"`);
  }
}
