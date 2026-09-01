import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { ResolveDirectoryDto } from './dto/resolve-directory.dto.js';

export interface DirectoryResolveResult {
  patients: Record<string, { displayName: string; patientNo: string }>;
  doctors: Record<string, { displayName: string }>;
  wards: Record<string, { displayName: string }>;
  beds: Record<string, { displayName: string }>;
  items: Record<string, { displayName: string }>;
}

@Injectable()
export class DirectoryService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  /**
   * Bulk id-to-display-name lookup for the many screens that carry a raw patientId/doctorId/
   * wardId/bedId (review-comments.md: "ward and bed are raw UUIDs" / the systemic UUID-picker
   * finding). One request per screen resolves every id it needs in a single round trip, instead
   * of each screen growing its own per-entity join or N+1 lookup. Deliberately no
   * @RequirePermission (see DirectoryController) — a caller already holds each id from a screen
   * it had permission to view; this only ever returns a name for an id supplied by the caller,
   * never a listing.
   */
  async resolve(input: ResolveDirectoryDto): Promise<DirectoryResolveResult> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Sequential, not Promise.all — these share one pg client via runInTenantSchema's single
      // queryRunner, and concurrent queries on one client are unsupported (pg deprecation
      // warning, and a real risk of protocol confusion, not just noise).
      const patients = input.patientIds?.length
        ? await manager.query(
            `SELECT id, "firstName", "lastName", "patientNo" FROM patients WHERE id = ANY($1)`,
            [input.patientIds],
          )
        : [];
      const doctors = input.doctorIds?.length
        ? await manager.query(`SELECT id, "displayName" FROM accounts WHERE id = ANY($1)`, [input.doctorIds])
        : [];
      const wards = input.wardIds?.length
        ? await manager.query(`SELECT id, "wardName" FROM wards WHERE id = ANY($1)`, [input.wardIds])
        : [];
      const beds = input.bedIds?.length
        ? await manager.query(`SELECT id, "bedNumber" FROM beds WHERE id = ANY($1)`, [input.bedIds])
        : [];
      const items = input.itemIds?.length
        ? await manager.query(`SELECT id, name FROM inventory_items WHERE id = ANY($1)`, [input.itemIds])
        : [];

      return {
        patients: Object.fromEntries(
          patients.map((p: { id: string; firstName: string; lastName: string; patientNo: string }) => [
            p.id,
            { displayName: `${p.firstName} ${p.lastName}`, patientNo: p.patientNo },
          ]),
        ),
        doctors: Object.fromEntries(
          doctors.map((d: { id: string; displayName: string }) => [d.id, { displayName: d.displayName }]),
        ),
        wards: Object.fromEntries(
          wards.map((w: { id: string; wardName: string }) => [w.id, { displayName: w.wardName }]),
        ),
        beds: Object.fromEntries(
          beds.map((b: { id: string; bedNumber: string }) => [b.id, { displayName: b.bedNumber }]),
        ),
        items: Object.fromEntries(
          items.map((i: { id: string; name: string }) => [i.id, { displayName: i.name }]),
        ),
      };
    });
  }
}
