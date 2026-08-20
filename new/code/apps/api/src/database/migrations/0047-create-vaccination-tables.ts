import { MigrationInterface, QueryRunner } from 'typeorm';

/** Vaccination records (PRD Phase 4 Clinical/EMR long-tail slice). */
export class CreateVaccinationTables0047 implements MigrationInterface {
  name = 'CreateVaccinationTables00472000000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE vaccination_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        vaccine varchar NOT NULL,
        "doseNumber" int NOT NULL DEFAULT 1,
        "administeredDate" date NOT NULL,
        "batchNumber" varchar NULL,
        "administeredBy" uuid NOT NULL,
        notes text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE vaccination_records`);
  }
}
