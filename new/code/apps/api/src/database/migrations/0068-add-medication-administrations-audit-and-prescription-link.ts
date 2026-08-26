import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (P2, code-review-findings-2026-08-25.md), nursing module:
 *  1. `medication_administrations` never got the audit-columns backfill its sibling
 *     `nursing_tasks` got in migration 0053 — added here, same `ADD COLUMN IF NOT EXISTS` shape.
 *  2. A skipped dose recorded no actor at all (`administeredBy` stays null for a Skip, and there
 *     was no dedicated column) — added `skippedBy`, `uuid` to match the existing `administeredBy`/
 *     `completedBy` actor-column convention on these two entities (the uuid-vs-varchar
 *     inconsistency itself is a separate, already-tracked cross-cutting finding — not
 *     re-litigated here).
 *  3. Nothing tied a MAR line to what authorized it — added a nullable `prescriptionId` (no DB-level
 *     FK, consistent with `admissionId`'s existing raw-lookup-only convention on this table). */
export class AddMedicationAdministrationsAuditAndPrescriptionLink3000000000068
  implements MigrationInterface
{
  name = 'AddMedicationAdministrationsAuditAndPrescriptionLink3000000000068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS "skippedBy" uuid`);
    await queryRunner.query(`ALTER TABLE medication_administrations ADD COLUMN IF NOT EXISTS "prescriptionId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE medication_administrations DROP COLUMN IF EXISTS "prescriptionId"`);
    await queryRunner.query(`ALTER TABLE medication_administrations DROP COLUMN IF EXISTS "skippedBy"`);
    await queryRunner.query(`ALTER TABLE medication_administrations DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE medication_administrations DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE medication_administrations DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE medication_administrations DROP COLUMN IF EXISTS "createdBy"`);
  }
}
