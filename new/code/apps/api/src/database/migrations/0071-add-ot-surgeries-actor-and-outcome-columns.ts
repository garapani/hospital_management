import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), ot module:
 *  - P2: start/complete/cancelSurgery accepted an actor parameter but only ever recorded
 *    scheduledBy — added startedBy/completedBy/cancelledBy so each transition's own sign-off
 *    is actually captured.
 *  - P3: no cancellation reason or post-op notes capture — added cancellationReason and
 *    postOpNotes (kept distinct from the pre-op `notes` column, which is set at schedule time).
 *  - P2 (partial — see Dev Standards): an OT room can't run two surgeries at once — added a
 *    partial unique index on `otRoom` while `status = 'InProgress'`. A full duration/interval
 *    overlap model for *scheduled* (not yet started) conflicts is a larger feature, not attempted
 *    here — see the finding's checklist annotation. */
export class AddOtSurgeriesActorAndOutcomeColumns3000000000071 implements MigrationInterface {
  name = 'AddOtSurgeriesActorAndOutcomeColumns3000000000071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "startedBy" uuid`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "completedBy" uuid`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "cancelledBy" uuid`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "cancellationReason" text`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "postOpNotes" text`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ot_surgeries_active_room" ON ot_surgeries ("otRoom")
      WHERE status = 'InProgress' AND "otRoom" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_ot_surgeries_active_room"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "postOpNotes"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "cancellationReason"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "cancelledBy"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "completedBy"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "startedBy"`);
  }
}
