import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsTable0028 implements MigrationInterface {
  name = 'CreateNotificationsTable00282000000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recipientAccountId" uuid NOT NULL,
        "title" character varying NOT NULL,
        "message" character varying NOT NULL,
        "type" character varying NOT NULL DEFAULT 'info',
        "isRead" boolean NOT NULL DEFAULT false,
        "link" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipientAccountId" ON "notifications" ("recipientAccountId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
