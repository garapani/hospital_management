import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md, cross-cutting/clinical group):
 *  almost none of these tables index the columns their own service layer filters on
 *  (migrations 0009, 0011, 0012, 0014, 0030, 0037, 0038, 0039, 0047). Plain non-unique indexes,
 *  one per column each service's WHERE clause actually uses — verified against each service's
 *  list()/find() calls, not assumed from the entity. `discharge_summaries.admissionId` and
 *  `maternity_records.admissionId` are skipped: both already have a unique index
 *  (`UQ_discharge_summaries_admission`, `UQ_maternity_records_admission`) that already accelerates
 *  equality lookups. `vaccination_records.patientId` is skipped for the same reason — it's the
 *  leading column of `UQ_vaccination_records_patient_vaccine_dose`. */
export class AddClinicalGroupFilterIndexes3000000000072 implements MigrationInterface {
  name = 'AddClinicalGroupFilterIndexes3000000000072';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // admissions: list() filters by patientId, wardId, status.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admissions_patientId" ON admissions ("patientId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admissions_wardId" ON admissions ("wardId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admissions_status" ON admissions (status)`);

    // appointments: list()/schedule queries filter by appointmentDate, doctorId, departmentId, status.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_appointments_appointmentDate" ON appointments ("appointmentDate")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_appointments_doctorId" ON appointments ("doctorId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_appointments_departmentId" ON appointments ("departmentId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_appointments_status" ON appointments (status)`);

    // clinical/encounters: getXByPatient() filters by patientId on each of the three tables.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_clinical_notes_patientId" ON clinical_notes ("patientId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_diagnoses_patientId" ON diagnoses ("patientId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_prescriptions_patientId" ON prescriptions ("patientId")`);

    // clinical/triage: listActive() filters status NOT IN (...).
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_triage_entries_status" ON triage_entries (status)`);

    // nursing: listTasks()/listAdministrations() filter by admissionId.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_nursing_tasks_admissionId" ON nursing_tasks ("admissionId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_medication_administrations_admissionId" ON medication_administrations ("admissionId")`);

    // ot: listSurgeries() filters by patientId, status.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ot_surgeries_patientId" ON ot_surgeries ("patientId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ot_surgeries_status" ON ot_surgeries (status)`);

    // maternity: listRecords() filters by patientId (admissionId already unique-indexed).
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_maternity_records_patientId" ON maternity_records ("patientId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_maternity_records_patientId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ot_surgeries_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ot_surgeries_patientId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_medication_administrations_admissionId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_nursing_tasks_admissionId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_triage_entries_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prescriptions_patientId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_diagnoses_patientId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_clinical_notes_patientId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointments_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointments_departmentId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointments_doctorId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointments_appointmentDate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admissions_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admissions_wardId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admissions_patientId"`);
  }
}
