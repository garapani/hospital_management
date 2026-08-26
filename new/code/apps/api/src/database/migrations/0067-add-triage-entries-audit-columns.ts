import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): triage_entries was the one
 *  tenant table migration 0053 missed — TriageEntry never extended AuditableEntity/
 *  SoftDeletableEntity, so it has no createdBy/updatedBy/deletedAt/deletedBy. Same
 *  ADD COLUMN IF NOT EXISTS shape as 0053, applied to the one table it left out. */
export class AddTriageEntriesAuditColumns3000000000067 implements MigrationInterface {
  name = 'AddTriageEntriesAuditColumns3000000000067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE triage_entries ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE triage_entries ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE triage_entries ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE triage_entries ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE triage_entries DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE triage_entries DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE triage_entries DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE triage_entries DROP COLUMN IF EXISTS "deletedBy"`);
  }
}
