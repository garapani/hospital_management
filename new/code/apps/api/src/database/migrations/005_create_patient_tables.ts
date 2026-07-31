import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePatientTables005 implements MigrationInterface {
  name = 'CreatePatientTables005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE patients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientNo" varchar(50) NOT NULL UNIQUE,
        "firstName" varchar(100) NOT NULL,
        "middleName" varchar(100),
        "lastName" varchar(100) NOT NULL,
        gender varchar(20) NOT NULL,
        "dateOfBirth" date,
        age varchar(20),
        "phoneNumber" varchar(20),
        email varchar(150),
        "bloodGroup" varchar(10),
        "governmentIdType" varchar(50),
        "governmentIdNumber" varchar(100),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE patient_addresses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        "addressType" varchar(20) NOT NULL DEFAULT 'home',
        "streetAddress" varchar(255),
        city varchar(100),
        state varchar(100),
        "postalCode" varchar(20),
        country varchar(100) NOT NULL DEFAULT 'India'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE patient_kins (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        "kinName" varchar(150) NOT NULL,
        relationship varchar(50) NOT NULL,
        "phoneNumber" varchar(20) NOT NULL,
        email varchar(150),
        address varchar(255)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE patient_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE patient_sequences`);
    await queryRunner.query(`DROP TABLE patient_kins`);
    await queryRunner.query(`DROP TABLE patient_addresses`);
    await queryRunner.query(`DROP TABLE patients`);
  }
}
