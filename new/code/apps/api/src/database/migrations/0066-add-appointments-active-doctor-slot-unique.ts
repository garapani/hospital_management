import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md): the doctor-conflict check in
 *  create()/update() was select-then-insert only, with no backing constraint — a race could
 *  double-book a doctor. Backs the application-level check with a DB constraint, matching the
 *  UQ_admissions_active_bed/UQ_admissions_active_patient pattern. Scoped to `doctorId IS NOT NULL`
 *  because appointments are allowed to omit a doctor (department-only bookings). */
export class AddAppointmentsActiveDoctorSlotUnique3000000000066 implements MigrationInterface {
  name = 'AddAppointmentsActiveDoctorSlotUnique3000000000066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_appointments_active_doctor_slot" ON appointments ("doctorId", "appointmentDate", "appointmentTime")
      WHERE status = 'Scheduled' AND "doctorId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_appointments_active_doctor_slot"`);
  }
}
