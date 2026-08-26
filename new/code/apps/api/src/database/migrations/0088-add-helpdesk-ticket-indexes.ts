import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): helpdesk_tickets had no
 *  indexes on the list filter columns — every listTickets run scans the table. Adds the three
 *  columns the queries filter/order on. */
export class AddHelpdeskTicketIndexes3000000000088 implements MigrationInterface {
  name = 'AddHelpdeskTicketIndexes3000000000088';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_helpdesk_tickets_status" ON helpdesk_tickets (status)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_helpdesk_tickets_assignee" ON helpdesk_tickets ("assigneeAccountId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_helpdesk_tickets_created" ON helpdesk_tickets ("createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_helpdesk_tickets_created"`);
    await queryRunner.query(`DROP INDEX "IDX_helpdesk_tickets_assignee"`);
    await queryRunner.query(`DROP INDEX "IDX_helpdesk_tickets_status"`);
  }
}
