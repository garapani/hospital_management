import { IsArray, IsString } from 'class-validator';

/** Replaces the tenant's enabled role set with exactly these role ids. */
export class SetTenantRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}
