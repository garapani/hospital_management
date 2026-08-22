import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProvisionTenantDto {
  @IsString()
  hospitalId!: string;

  @IsString()
  hospitalName!: string;

  /** SaaS package to provision under; defaults to 'basic' when omitted. */
  @IsOptional()
  @IsString()
  packageCode?: string;

  /** Optional bootstrap Hospital Admin account. When omitted, the backend generates a username
   *  and password and returns them as `adminCredentials` in the response. */
  @IsOptional()
  @IsString()
  adminUsername?: string;

  @IsOptional()
  @IsString()
  adminEmail?: string;

  // @IsNotEmpty (not just @IsString): createBootstrapAdmin's `provided.password ?? generated`
  // (tenants.service.ts) only falls back on null/undefined, not "" — an empty string here would
  // silently create the bootstrap admin with an empty password instead of a generated one.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  adminPassword?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentCatalogIds?: string[];
}
