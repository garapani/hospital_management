export class ProvisionTenantDto {
  hospitalId!: string;
  hospitalName!: string;
  /** SaaS package to provision under; defaults to 'basic' when omitted. */
  packageCode?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}
