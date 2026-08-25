import { Column, Entity, PrimaryColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

/** Per-tenant white-label config (public schema — platform-admin-configured, never visible to the
 *  hospital itself). Absent row / null fields fall back to the default Vaidya brand. */
@Entity('tenant_branding')
export class TenantBranding extends SoftDeletableEntity {
  @PrimaryColumn({ type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  /** Hex color, e.g. `#006D77`. */
  @Column({ type: 'varchar', length: 7, nullable: true })
  primaryColor!: string | null;

  /** Object storage key (namespaced under the tenant by `ObjectStorageService`), not a URL — the
   *  logo is served via a short-lived presigned URL, never a public bucket path. */
  @Column({ type: 'varchar', nullable: true })
  logoObjectKey!: string | null;

  /** Login-page headline override, e.g. "Hospital operations, one screen at a time." */
  @Column({ type: 'varchar', nullable: true })
  tagline!: string | null;

  /** Login-page subtitle paragraph override, shown under the tagline. */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Trailing text after "© {year}" on the login page (defaults to the tenant display name). */
  @Column({ type: 'varchar', nullable: true })
  footerText!: string | null;

  /** Replaces the login form's fixed "Trouble signing in? Contact your hospital administrator." */
  @Column({ type: 'varchar', nullable: true })
  supportText!: string | null;
}
