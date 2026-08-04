import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBedsTable0013 implements MigrationInterface {
  name = 'CreateBedsTable00132000000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE beds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "wardId" uuid NOT NULL,
        "bedNumber" varchar NOT NULL,
        "bedType" varchar NULL,
        status varchar NOT NULL DEFAULT 'Available',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_beds_ward_bed_number" UNIQUE ("wardId", "bedNumber")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE beds`);
  }
}
