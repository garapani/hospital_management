# India Compliance Roadmap

**Status:** product-scoping document, not an engineering commitment. Written 2026-08-22 per
`pending-tasks.md` Phase 5 item 13 (`new-features.md` #14) — "product-scoping work, not blocking
engineering." Nothing here is a build order; it exists so a real requirement (a tenant's
accreditation audit, a regulator notice, a specific hospital's compliance officer asking "do you
support X") can be triaged against a pre-thought-through list instead of from scratch.

**How to use this doc:** when a compliance requirement becomes real (a tenant asks, a deal
requires it, a regulator changes something), pull the relevant row below into
`pending-tasks.md` as a normal engineering item with its own spec/plan. This doc stays the
one-time landscape survey; it isn't re-litigated per tenant.

## Scope

Covers regulatory/compliance surface area for operating a hospital EMR SaaS in India, scoped to
what `PRD.md` §1/§9.4/§10 already commits to (India-only market, self-owned India-hosted
infrastructure, 10-20 hospital tenants). Excludes Nepal/Bangladesh-specific compliance (the old
system's `DanpheEMR.Sync` IRD/SSF logic) — out of scope per `PRD.md` §1/§10, not carried forward.

## What's already in place (don't re-derive these)

| Requirement area | Current state | Where |
|---|---|---|
| Data residency | All tenant data on self-owned, India-hosted infrastructure; no cross-border transfer | `PRD.md` §9.1, §10 — architectural commitment, not a toggle |
| Audit trail | Every domain's create/update/delete is captured as an audit event, written to the tenant's own schema, survives even a tenant purge (recorded on the platform trail) | `@hospital/audit-emitter`, `audit_records` per tenant schema |
| PII-aware log redaction | Structured (pino) logs redact `password`, `token`, `refreshToken`, `authorization`, `ssn`, `dob`, `diagnosis` (and nested variants) before they hit disk | `libs/observability/src/lib/observability-logger.module.ts` `REDACT_PATHS` |
| Tenant data lifecycle / right-to-erasure primitive | archive (soft, reversible, login blocked) → purge (hard, irreversible, typed confirmation, drops schema+role+registry row, purge event itself survives in the platform audit trail) | `TenantsService.archiveTenant/restoreTenant/purgeTenant`, `Development-Standards.md` §47 |
| Tenant isolation at the DB layer | Per-tenant Postgres schema + `NOLOGIN` role, `SET LOCAL ROLE` inside every tenant query — proven by an integration test asserting cross-schema access fails at the Postgres permission layer, not just app logic | `TenantConnectionService`, `Development-Standards.md` §8 |
| GST-compliant invoicing (India tax) | `billing_settings` (GSTIN, state code, hospital legal name) + per-invoice `taxableAmount`/`taxAmount`/`hsnSacCode` | `apps/api/src/billing/` — see the architecture note below |

## Architecture note: GST landed inside Billing, not as a separate adapter module

`PRD.md` G5 and §5.7 called for a pluggable **India Compliance Adapter** module, isolated from
core clinical/billing modules so it "stays replaceable if [the India-only assumption] ever
changes." What actually shipped: `gstin`/`stateCode`/`hospitalLegalName` live on
`BillingSettings`, and `taxableAmount`/`taxAmount`/`hsnSacCode` live directly on `Invoice`/
`InvoiceItem` inside the `billing` module — no separate `india-compliance` module exists.

This is a real, if minor, divergence from the PRD's stated architecture goal, not a bug — GST math
is intrinsically an invoice-line concern, and Billing has no non-Indian tenant today to keep it
isolated from. Documented here rather than silently left implicit: if a future feature needs the
adapter boundary literally (e.g. a second country, or ABHA/PM-JAY logic that genuinely shouldn't
touch Billing's tables), that's the trigger to actually extract one — not before. No action needed
today.

## Gap checklist

Each row: what the regulation/requirement actually asks for, current state, which existing
modules it would touch if built, and a rough priority signal (not a schedule).

| # | Requirement | Regulatory basis | Current state | Modules touched | Priority signal |
|---|---|---|---|---|---|
| 1 | Consent capture & tracking (treatment consent, data-sharing consent, marketing consent) | DPDP Act 2023 (consent as the primary lawful basis for processing personal data); Clinical Establishments Act (treatment consent, separately from data-protection consent) | **Not implemented.** No consent field/table anywhere in `patients`, `accounts`, or `marketing`. Registration and referral flows collect PII with no consent record. | Patients (registration), Marketing & Referral | **High** — this is the one gap most likely to surface as a real blocker (a hospital's own DPDP compliance review, or an accreditation audit) rather than a government integration nobody's asked for yet |
| 2 | Data principal rights: access, correction, erasure, grievance redressal | DPDP Act 2023 §§11-13 (right to access/correction/erasure), §13 (grievance redressal) | **Partial.** Patient record correction exists as ordinary CRUD (no audit-visible "this was a DPDP correction request" marker). Erasure exists at the *tenant* level (purge, §47) but there is no *per-patient* erasure/anonymization path — purging one patient's PII while keeping clinical/billing history intact (as most erasure regimes actually require, since medical records retention law usually overrides a blanket delete) doesn't exist. No grievance-intake surface. | Patients, Audit, a new "Data Subject Requests" surface | **Medium** — real requirement, but the shape of an EMR-appropriate erasure ("anonymize PII, keep clinical/billing records for statutory retention") needs product scoping before it's a build item, not just "add a delete button" |
| 3 | Data retention & medical records retention period | Clinical Establishments (Registration & Regulation) Act 2010 + state rules (retention periods for medical records vary by state/record type, commonly 3-10 years); DPDP Act's storage-limitation principle | **Not implemented as policy.** Nothing currently expires or flags records for retention-driven action; the only "deletion" path is the tenant-level purge (§47), which is an all-or-nothing operational action, not a per-record retention schedule. | Patients, Clinical (encounters/diagnoses/prescriptions), Billing, Lab, Radiology | **Low-Medium** — no confirmed tenant has asked for this; worth a design pass before any tenant's records actually age past a plausible retention window |
| 4 | Government disease-reporting mapping (notifiable diseases, IDSP, TB via Nikshay) | Epidemic Diseases Act 1897 + Integrated Disease Surveillance Programme (IDSP) notifiable-disease reporting; National TB Elimination Programme mandatory Nikshay reporting | **Not implemented.** Already named as a distinct future item in `pending-tasks.md` Phase 6's Lab entry — no notifiable-disease flagging or external reporting integration exists. | Lab/LIS, Clinical (diagnoses) | **Low** — no confirmed tenant is a TB-reporting or IDSP-mandated facility type; revisit only when one is |
| 5 | PM-JAY (Ayushman Bharat) claim formats | National Health Authority PM-JAY claim/transaction specification | **Not implemented.** `insurance` module's claims lifecycle (Draft→Submitted→Approved→Paid/Rejected) is a generic reimbursement model, not PM-JAY's specific transaction/claim schema. Already named as deferred in the Insurance & Claims module notes (`pending-tasks.md` Phase 3). | Insurance & Claims | **Low** — deferred by product decision until a PM-JAY-empanelled tenant is confirmed; per `PRD.md` §3/§5.7, explicitly out of scope until then |
| 6 | ABHA/ABDM (national health ID linkage) | Ayushman Bharat Digital Mission — ABHA-based patient identification, interoperable health records | **Not implemented.** No ABHA ID field on `Patient`, no ABDM integration. Explicitly deferred per `PRD.md` §3/§5.7/§12 open question #2 — "not yet scheduled against any specific tenant's needs." | Patients | **Low** — same status as #5; PRD already treats this as speculative until a tenant needs it |
| 7 | ESI/PF (employee statutory payroll deductions) | Employees' State Insurance Act 1948, Employees' Provident Fund Act 1952 | **Not implemented.** `payroll` module computes gross/net from `monthlyBasicSalary` with allowance/deduction percentages — no ESI/PF-specific statutory calculation or filing format. Explicitly deferred per `PRD.md` §3/§5.7. | Payroll | **Low** — same as #5/#6; every current tenant's payroll need is met by the generic percentage-based model |
| 8 | Breach notification | DPDP Act 2023 §8(6) (notify the Data Protection Board and affected data principals on a personal-data breach) | **Not implemented as a process.** The audit trail would supply forensic evidence *after* an incident is detected, but there is no breach-detection tooling, no notification workflow, and no named process owner. | Audit, Observability (alerting) | **Medium** — this is an operational/process gap more than a code gap; a written incident-response runbook addition costs little and is worth doing independent of any tenant asking |
| 9 | Significant Data Fiduciary obligations (DPIA, data protection officer, periodic audits) | DPDP Act 2023 §10 — applies above a data-volume/sensitivity threshold the Act leaves to government notification | **Not applicable yet** at 10-20 tenant scale, but the threshold is set by rules, not by this product — worth a periodic re-check, not a build item. | — | **Watch only** |

## Recommended sequencing (not a schedule)

Ordered by "cheapest to do independent of any specific tenant asking" first:

1. **#8 (breach notification runbook)** — a `Runbook.md` addition, no code. Cheapest, and the kind
   of gap that's embarrassing to discover reactively during an actual incident.
2. **#1 (consent capture)** — the most likely to become a real blocker unprompted (a hospital's
   own DPDP review), and the smallest actual build (a consent table + a registration-flow field),
   but needs a short product-scoping pass first (what consent types, opt-in vs. opt-out defaults,
   whether consent withdrawal needs its own audit trail).
3. **#2 and #3 (data-subject rights / retention)** — needs real design work (per-patient
   anonymization that respects medical-records retention law is genuinely non-trivial, not a
   CRUD feature) before it's an engineering item. Worth a scoping conversation once #1 lands, not
   before.
4. **#4, #5, #6, #7** — stay exactly where `PRD.md` already puts them: deferred until a specific
   tenant's need makes them real. Building any of these speculatively risks the same mistake
   `PRD.md` §11 already flags for the India Compliance Adapter generally — real regulatory
   research is expensive, and building against a guessed spec is worse than not building at all.

## Non-goals (explicitly, so this doesn't get re-asked)

- Nepal/Bangladesh compliance (old system's `DanpheEMR.Sync`) — this product is India-only
  (`PRD.md` §1, §10).
- Multi-region data residency / cross-border transfer support — `PRD.md` §3 rules out
  multi-region entirely.
- Building #4-#7 speculatively ahead of a confirmed tenant need — matches `PRD.md`'s own
  deferral decision for ABHA/PM-JAY/ESI-PF (§3), extended here to disease-reporting/PM-JAY claim
  formats for the same reason.
