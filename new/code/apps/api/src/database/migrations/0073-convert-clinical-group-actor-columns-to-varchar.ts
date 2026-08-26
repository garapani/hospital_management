import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md, cross-cutting/clinical group):
 *  actor columns were left `uuid NOT NULL`/`uuid nullable` while audit columns (createdBy/
 *  updatedBy/deletedBy) were deliberately made `varchar` for the same reason — this codebase's
 *  test suite routinely signs tokens with human-readable `sub` values ('ops.alice', ...), which a
 *  uuid-typed column rejects outright (see auditable.entity.ts's own comment on this). Converts
 *  the same class of column: `triage_entries.triagedBy`, `nursing_tasks.completedBy`,
 *  `medication_administrations.administeredBy`/`skippedBy` (the latter added this same review
 *  pass — converted now rather than reintroducing the inconsistency this migration exists to
 *  close). `assignedTo` on nursing_tasks is NOT converted: it's a task assignment (who a task is
 *  FOR), not an audit "who performed this action" actor field — a different semantic, out of the
 *  finding's scope. */
export class ConvertClinicalGroupActorColumnsToVarchar3000000000073 implements MigrationInterface {
  name = 'ConvertClinicalGroupActorColumnsToVarchar3000000000073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE triage_entries ALTER COLUMN "triagedBy" TYPE varchar USING "triagedBy"::varchar`);
    await queryRunner.query(`ALTER TABLE nursing_tasks ALTER COLUMN "completedBy" TYPE varchar USING "completedBy"::varchar`);
    await queryRunner.query(`ALTER TABLE medication_administrations ALTER COLUMN "administeredBy" TYPE varchar USING "administeredBy"::varchar`);
    await queryRunner.query(`ALTER TABLE medication_administrations ALTER COLUMN "skippedBy" TYPE varchar USING "skippedBy"::varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE medication_administrations ALTER COLUMN "skippedBy" TYPE uuid USING "skippedBy"::uuid`);
    await queryRunner.query(`ALTER TABLE medication_administrations ALTER COLUMN "administeredBy" TYPE uuid USING "administeredBy"::uuid`);
    await queryRunner.query(`ALTER TABLE nursing_tasks ALTER COLUMN "completedBy" TYPE uuid USING "completedBy"::uuid`);
    await queryRunner.query(`ALTER TABLE triage_entries ALTER COLUMN "triagedBy" TYPE uuid USING "triagedBy"::uuid`);
  }
}
