import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLabRequisitionsActiveUniqueIndex0019 implements MigrationInterface {
  name = 'AddLabRequisitionsActiveUniqueIndex00192000000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_lab_requisitions_active_order_item"
      ON lab_requisitions ("orderItemId")
      WHERE status <> 'Cancelled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_lab_requisitions_active_order_item"`);
  }
}
