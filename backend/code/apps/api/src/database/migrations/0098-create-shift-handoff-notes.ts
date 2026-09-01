import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nurse-to-nurse shift handoff notes, one per admission — a core daily ritual on any ward that
 * was entirely unsupported until now (grep for handoff/hand-off across the codebase returned
 * nothing; see review-comments.md, "No shift-handoff notes feature"). Same shape as
 * nursing_tasks/medication_administrations (admissionId-scoped, ward-restricted via
 * NursingService's existing assertWardAccess machinery) — lives in the nursing module rather than
 * a new one.
 */
export class CreateShiftHandoffNotes3000000000004 implements MigrationInterface {
  name = 'CreateShiftHandoffNotes3000000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE shift_handoff_notes (
          id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
          "admissionId" uuid NOT NULL,
          shift character varying,
          note text NOT NULL,
          acknowledged boolean DEFAULT false NOT NULL,
          "acknowledgedBy" character varying,
          "acknowledgedAt" timestamp with time zone,
          "createdBy" character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_shift_handoff_notes_admissionId" ON shift_handoff_notes USING btree ("admissionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE shift_handoff_notes`);
  }
}
