import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): the notifications index shape
 *  didn't match the query shape — the only index was a bare (recipientAccountId), while every
 *  read either counts unread rows (getSummary: recipientAccountId + isRead) or lists newest-first
 *  (recipientAccountId + createdAt DESC). Replaces it with the two shapes the queries actually use.
 *  The retention half of the finding (no cleanup path for old notifications) is a scheduler/ops
 *  feature — captured as new-features.md #23. */
export class AddNotificationQueryShapeIndexes3000000000087 implements MigrationInterface {
  name = 'AddNotificationQueryShapeIndexes3000000000087';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notifications_recipientAccountId"`);
    // Newest-first list: matches getSummary's recentNotifications and list()'s ordering.
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_created"
      ON "notifications" ("recipientAccountId", "createdAt" DESC)
    `);
    // Unread-count: partial index covering exactly getSummary's count predicate.
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_unread"
      ON "notifications" ("recipientAccountId") WHERE "isRead" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notifications_recipient_unread"`);
    await queryRunner.query(`DROP INDEX "IDX_notifications_recipient_created"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipientAccountId" ON "notifications" ("recipientAccountId")
    `);
  }
}
