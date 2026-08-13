/**
 * Reserved system tenant that platform ("Super Admin") accounts live in.
 *
 * It is not a hospital: it is never returned by tenant listings or direct fetches, never
 * provisionable through the API, and never suspendable. Platform operators live here so that
 * suspending or deleting any real hospital cannot orphan the account that administers the platform.
 */
export const PLATFORM_TENANT_ID = '__platform';
