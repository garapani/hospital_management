/** Replaces the tenant's enabled role set with exactly these role ids. */
export class SetTenantRolesDto {
  roleIds!: string[];
}
