/**
 * Reserved system tenant that platform ("Super Admin") accounts live in.
 *
 * It is not a hospital: it is never returned by tenant listings or direct fetches, never
 * provisionable through the API, and never suspendable. Platform operators live here so that
 * suspending or deleting any real hospital cannot orphan the account that administers the platform.
 */
export const PLATFORM_TENANT_ID = '__platform';

/**
 * The effective platform tenant id. `PLATFORM_ADMIN_TENANT_ID` is a test-only override so
 * integration specs can point platform-tenant behavior (role catalog, cross-tenant account
 * creation) at a throwaway tenant instead of the real `__platform` schema — see
 * seed-initial-setup.integration-spec.ts. Production never sets it.
 */
export function resolvePlatformTenantId(): string {
  return process.env['PLATFORM_ADMIN_TENANT_ID'] ?? PLATFORM_TENANT_ID;
}
