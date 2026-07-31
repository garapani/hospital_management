import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTriageTable0012 implements MigrationInterface {
  name = 'CreateTriageTable0012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "triage_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patientId" uuid,
        "firstName" character varying,
        "lastName" character varying,
        "gender" character varying,
        "estimatedAge" character varying,
        "arrivalMode" character varying,
        "broughtBy" character varying,
        "isPoliceCase" boolean NOT NULL DEFAULT false,
        "chiefComplaint" text,
        "acuityLevel" integer,
        "colorCode" character varying,
        "triagedBy" uuid,
        "triagedAt" TIMESTAMP WITH TIME ZONE,
        "status" character varying NOT NULL DEFAULT 'Arrived',
        "dischargeRemarks" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_triage_entries" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "triage_entries"`);
  }
}
