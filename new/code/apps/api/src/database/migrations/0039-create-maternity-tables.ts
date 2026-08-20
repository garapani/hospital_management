import { MigrationInterface, QueryRunner } from 'typeorm';

/** Maternity module (PRD Phase 4): labor/delivery records. */
export class CreateMaternityTables0039 implements MigrationInterface {
  name = 'CreateMaternityTables00392000000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE maternity_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admissionId" uuid NOT NULL,
        "patientId" uuid NOT NULL,
        gravida int NOT NULL DEFAULT 0,
        para int NOT NULL DEFAULT 0,
        lmp date NULL,
        edd date NULL,
        "deliveryDate" date NULL,
        "deliveryType" varchar NULL,
        "babyCount" int NOT NULL DEFAULT 0,
        complications text NULL,
        "deliveredBy" uuid NULL,
        notes text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE maternity_records`);
  }
}
