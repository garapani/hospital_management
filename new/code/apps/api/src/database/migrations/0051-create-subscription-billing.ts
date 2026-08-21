import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubscriptionBilling1000000000051 implements MigrationInterface {
  name = 'CreateSubscriptionBilling1000000000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" varchar NOT NULL REFERENCES tenants("hospitalId") ON DELETE CASCADE,
        "packageCode" varchar NOT NULL,
        "billingCycle" varchar(10) NOT NULL,
        "pricePerCycle" int NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'active',
        "currentPeriodStart" timestamptz NOT NULL,
        "currentPeriodEnd" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscriptions_tenantId" ON subscriptions ("tenantId")`,
    );
    await queryRunner.query(`
      CREATE TABLE subscription_invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscriptionId" uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        "tenantId" varchar NOT NULL,
        "periodStart" timestamptz NOT NULL,
        "periodEnd" timestamptz NOT NULL,
        amount int NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'open',
        "issuedAt" timestamptz NOT NULL DEFAULT now(),
        "paidAt" timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_invoices_tenantId" ON subscription_invoices ("tenantId")`,
    );
    // One open invoice per subscription period (re-issuing the same period is a 409).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_invoices_period"
       ON subscription_invoices ("subscriptionId", "periodStart") WHERE status = 'open'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE subscription_invoices`);
    await queryRunner.query(`DROP TABLE subscriptions`);
  }
}
