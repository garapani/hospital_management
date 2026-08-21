export class ProvisionTenantDto {
  hospitalId!: string;
  hospitalName!: string;
  /** SaaS package to provision under; defaults to 'basic' when omitted. */
  packageCode?: string;
  /** Optional bootstrap Hospital Admin account. When omitted, the backend generates a username
   *  and password and returns them as `adminCredentials` in the response. */
  adminUsername?: string;
  adminEmail?: string;
  adminPassword?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}
