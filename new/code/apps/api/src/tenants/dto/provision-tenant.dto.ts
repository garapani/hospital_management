export class ProvisionTenantDto {
  hospitalId!: string;
  hospitalName!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}
