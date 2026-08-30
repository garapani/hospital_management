import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ProvisionTenantDto {
  // Capped at 56 so `tenant_<hospitalId>` (7 prefix chars) stays under Postgres's 63-char
  // identifier limit — a longer id would silently truncate the schema/role names and provision
  // into a mismatched schema (MVP module pass, 2026-08-30).
  @IsString()
  @MaxLength(56)
  hospitalId!: string;

  @IsString()
  @MaxLength(255)
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
  // @MinLength(8) closes the auth P2: a tenant must never be provisioned with a 1-character
  // Hospital Admin password (the service enforces it too; the DTO rejects it at the pipe).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  adminPassword?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  createdBy?: string;

  // UUID-typed columns — plain strings would pass validation and turn a bad FK into a raw 500
  // (code-review-findings-2026-08-25 tenants P3).
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  departmentCatalogIds?: string[];
}
