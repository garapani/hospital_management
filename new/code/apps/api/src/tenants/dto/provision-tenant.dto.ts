export class ProvisionTenantDto {
  hospitalId!: string;
  hospitalName!: string;
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}
