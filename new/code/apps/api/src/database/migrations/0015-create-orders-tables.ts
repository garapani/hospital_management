import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrdersTables0015 implements MigrationInterface {
  name = 'CreateOrdersTables0015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "sourceAppointmentId" uuid NULL,
        "sourceAdmissionId" uuid NULL,
        "orderedBy" uuid NOT NULL,
        "orderedAt" timestamptz NOT NULL DEFAULT now(),
        notes text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderId" uuid NOT NULL,
        "itemType" varchar NOT NULL,
        "itemDescription" text NOT NULL,
        priority varchar NOT NULL DEFAULT 'Routine',
        status varchar NOT NULL DEFAULT 'Pending',
        "completedBy" uuid NULL,
        "completedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_order_items_order_id" ON order_items ("orderId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE order_items`);
    await queryRunner.query(`DROP TABLE orders`);
  }
}
