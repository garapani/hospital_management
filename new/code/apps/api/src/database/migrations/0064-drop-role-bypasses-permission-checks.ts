import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P1, code-review-findings-2026-08-25.md): `bypassesPermissionChecks` was
 *  dead code — `PermissionGuard` never read it, so Super Admin/Hospital Admin's "full access" came
 *  entirely from their explicit permission grants (already seeded alongside the flag for both
 *  roles), never from this column. Removed rather than wired up: a boolean "skip every check" flag
 *  is a riskier mechanism to keep around unused than the explicit per-permission grants this
 *  codebase already relies on everywhere else, and it was reachable over HTTP via
 *  UpdateRoleDto (a separate P2 in the same findings doc) with no effect other than the illusion
 *  of one. Hospital Admin's actual permission gaps (Lab/Radiology workflow, Pharmacy, Inventory)
 *  are fixed separately in seed-rbac-catalog.ts. */
export class DropRoleBypassesPermissionChecks3000000000064 implements MigrationInterface {
  name = 'DropRoleBypassesPermissionChecks3000000000064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN "bypassesPermissionChecks"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE roles ADD COLUMN "bypassesPermissionChecks" boolean NOT NULL DEFAULT false`,
    );
  }
}
