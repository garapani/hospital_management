# System Admin Service — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1, §8 Phase 0, §9.1)
**Old-system source (field inspiration only, not a parity contract — see PRD line 6):** `old/hospital-management-emr/Code/Components/DanpheEMR.ServerModel/SystemAdminModels/SysAdmin_Parameters.cs` (`AdminParametersModel`), `AccountingModels/Config/HospitalModel.cs`

## Scope

Owns the platform's tenant registry, tenant provisioning, per-tenant module toggles, and per-tenant settings. This is a Phase 0 service (§8) — no other service has anywhere to create a hospital's data until this one exists and provisioning has run.

**Note on old-system precedent:** `Controllers/SystemAdmin` in `old/` is almost entirely DB backup/restore/export, audit-trail viewing, and Nepal IRD tax reporting — none of which is this service's job. The old system is one hospital per install, so it never needed tenant provisioning. This service's core responsibility has **no old-system precedent**, similar to Identity & Access's refresh-token/lockout design and the India Compliance Adapter. The one reusable shape is `AdminParametersModel` (a generic parameter-group/name/value/type store), reused below for per-tenant settings.

## Data model

System Admin Service's own dedicated Postgres instance (§4) has two layers, not one — this is a stated exception to §4's blanket "one schema per tenant" rule:

### Platform-level (outside any tenant schema)

| Table | Key fields | Notes |
|---|---|---|
| `tenants` | hospital_id (PK), hospital_name, status (`active`\|`suspended`), created_at, activated_at, suspended_at, created_by | The master tenant registry. Must live outside any `tenant_<hospitalId>` schema, because that schema doesn't exist yet when this row is first created — provisioning produces the schema, it can't presuppose it. License is a simple active/suspended flag per hospital, not a plan/tier/entitlement model — matches the confirmed internal-ops-only onboarding at 10-20 tenants (PRD §9.1, §12). |

### Per-tenant (inside `tenant_<hospitalId>`, created once provisioning completes)

| Table | Key fields | Notes |
|---|---|---|
| `module_toggles` | module_key, is_enabled | Feature-flag only — every one of the ~36 services still runs for every tenant (§9.1, no new containers per hospital); a disabled module is hidden from that hospital's UI/routing, not un-deployed. |
| `hospital_settings` | parameter_group, parameter_name, parameter_value, value_data_type | Generic per-hospital config (locale, fiscal year start, invoice numbering format, etc.) — shape carried over from the old `AdminParametersModel`. |

## Tenant provisioning flow

1. Ops creates a tenant via an internal-only admin action (no public signup, per PRD §3/§12 resolved) → row inserted into `tenants` with `status = active`.
2. System Admin Service publishes `tenant.provisioned` `{hospitalId, hospitalName, occurredAt}` on RabbitMQ.
3. Every other service (including System Admin Service itself, for its own per-tenant tables above) consumes the event and creates its `tenant_<hospitalId>` schema, running its migration set against it. Schema creation must be idempotent (`CREATE SCHEMA IF NOT EXISTS` + idempotent migrations) since RabbitMQ delivery is at-least-once and the event may be redelivered.
4. Each consuming service publishes `tenant.schema_ready {hospitalId, serviceName, occurredAt}` on success. System Admin Service aggregates these acks and exposes a provisioning-status view (e.g. "34/36 services ready for hospital X") — without this, a single service silently failing to create its schema is invisible until a hospital's staff hits a confusing error in that one service weeks later. This directly serves the §10 NFR ("provisioned in under 5 minutes, no downtime") by making it verifiable, not just fast.

## Tenant suspension flow

1. Ops suspends a tenant → `tenants.status` set to `suspended`, `suspended_at` recorded.
2. System Admin Service publishes `tenant.status_changed {hospitalId, status, occurredAt}`.
3. Identity & Access Service consumes this and refuses new login/refresh-token issuance for that `hospitalId` going forward. Already-issued access tokens (short-lived, ~15min per the Identity & Access design) simply expire on their own shortly after — no need for every one of the ~36 services to independently enforce suspension in real time.

## Error handling

- Provisioning a `hospitalId` that already exists in `tenants` → reject with a clear conflict error, not a silent no-op (ops should know they tried to re-provision an existing hospital).
- A consuming service that fails to create its schema should retry via RabbitMQ's normal redelivery/dead-letter handling, not silently drop the event — the missing `tenant.schema_ready` ack is what surfaces the failure to ops.

## Testing

- Idempotency test: replaying `tenant.provisioned` for an already-provisioned hospital must not error or duplicate schema objects in any consuming service.
- End-to-end provisioning test: publish `tenant.provisioned`, assert `tenant.schema_ready` arrives from all currently-built services within the §10 5-minute target.
- Suspension test: after `tenant.status_changed` to `suspended`, Identity & Access must reject new logins for that `hospitalId` while leaving other tenants unaffected (cross-tenant isolation, same category of test as Identity & Access's own cross-tenant leakage test).
