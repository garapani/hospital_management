import { MigrationInterface, QueryRunner } from 'typeorm';

/** Helpdesk module (PRD Phase 6): internal ticketing. */
export class CreateHelpdeskTables0044 implements MigrationInterface {
  name = 'CreateHelpdeskTables00442000000000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE helpdesk_tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ticketNumber" varchar NOT NULL UNIQUE,
        title varchar NOT NULL,
        description text NOT NULL,
        category varchar NULL,
        priority varchar NOT NULL DEFAULT 'Medium',
        status varchar NOT NULL DEFAULT 'Open',
        "requesterAccountId" uuid NOT NULL,
        "assigneeAccountId" uuid NULL,
        "resolvedBy" uuid NULL,
        "resolvedAt" timestamptz NULL,
        "closedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE helpdesk_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE helpdesk_sequences`);
    await queryRunner.query(`DROP TABLE helpdesk_tickets`);
  }
}
