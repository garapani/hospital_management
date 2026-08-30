import { IsArray, IsUUID } from 'class-validator';

/** Replaces the tenant's enabled role set with exactly these role ids. */
export class SetTenantRolesDto {
  // UUID ids — matching ProvisionTenantDto's @IsUUID: the §107 rule (write-path uuid fields use
  // @IsUUID, not @IsString) was missed here. The service also rejects unknown ids with a 400,
  // so this is pipe-level consistency, not a 500 fix.
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds!: string[];
}
