import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLabTables0018 implements MigrationInterface {
  name = 'CreateLabTables00182000000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lab_test_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE lab_tests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "categoryId" uuid NOT NULL,
        name varchar NOT NULL,
        code varchar NOT NULL,
        "specimenType" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_lab_tests_category_id" ON lab_tests ("categoryId")`);
    await queryRunner.query(`
      CREATE TABLE lab_test_components (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "testId" uuid NOT NULL,
        name varchar NOT NULL,
        unit varchar NULL,
        "referenceRangeLow" numeric NULL,
        "referenceRangeHigh" numeric NULL,
        "referenceRangeText" varchar NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_test_components_test_id" ON lab_test_components ("testId")`,
    );
    await queryRunner.query(`
      CREATE TABLE lab_requisitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderItemId" uuid NOT NULL,
        "testId" uuid NOT NULL,
        "requisitionNumber" varchar NOT NULL,
        "specimenType" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "sampleCollectedBy" uuid NULL,
        "sampleCollectedAt" timestamptz NULL,
        "verifiedBy" uuid NULL,
        "verifiedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lab_requisitions_requisition_number" UNIQUE ("requisitionNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_requisitions_order_item_id" ON lab_requisitions ("orderItemId")`,
    );
    await queryRunner.query(`
      CREATE TABLE lab_results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requisitionId" uuid NOT NULL,
        "componentId" uuid NOT NULL,
        value varchar NOT NULL,
        "isAbnormal" boolean NOT NULL DEFAULT false,
        "enteredBy" uuid NOT NULL,
        "enteredAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lab_results_requisition_component" UNIQUE ("requisitionId", "componentId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_results_requisition_id" ON lab_results ("requisitionId")`,
    );
    await queryRunner.query(`
      CREATE TABLE lab_requisition_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE lab_requisition_sequences`);
    await queryRunner.query(`DROP TABLE lab_results`);
    await queryRunner.query(`DROP TABLE lab_requisitions`);
    await queryRunner.query(`DROP TABLE lab_test_components`);
    await queryRunner.query(`DROP TABLE lab_tests`);
    await queryRunner.query(`DROP TABLE lab_test_categories`);
  }
}
