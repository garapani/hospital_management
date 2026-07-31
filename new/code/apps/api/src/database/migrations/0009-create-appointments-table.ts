import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppointmentsTable0009 implements MigrationInterface {
  name = 'CreateAppointmentsTable0009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE appointments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NULL,
        "firstName" varchar(100) NOT NULL,
        "lastName" varchar(100) NOT NULL,
        "contactNumber" varchar(20) NOT NULL,
        "appointmentDate" date NOT NULL,
        "appointmentTime" time NOT NULL,
        "doctorId" uuid NULL,
        "departmentId" uuid NULL,
        "appointmentType" varchar(50) NOT NULL,
        "status" varchar(50) NOT NULL,
        "reason" text NULL,
        "cancelledRemarks" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE appointments`);
  }
}
