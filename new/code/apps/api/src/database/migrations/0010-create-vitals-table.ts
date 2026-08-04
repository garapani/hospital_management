import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVitalsTable0010 implements MigrationInterface {
  name = 'CreateVitalsTable00102000000000007';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE vitals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL REFERENCES patients(id),
        "appointmentId" uuid REFERENCES appointments(id),
        height decimal(5,2),
        weight decimal(5,2),
        bmi decimal(5,2),
        temperature decimal(4,1),
        pulse int,
        "bpSystolic" int,
        "bpDiastolic" int,
        "respiratoryRate" int,
        "spO2" decimal(5,2),
        "painScale" int,
        "triageNotes" text,
        "recordedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX idx_vitals_patient_id ON vitals("patientId");
      CREATE INDEX idx_vitals_appointment_id ON vitals("appointmentId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE vitals`);
  }
}
