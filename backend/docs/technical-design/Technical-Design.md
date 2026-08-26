# Technical Design

## Architecture
The system is built as a **Modular Monolith** using **NestJS** and **Nx**.
We utilize **PostgreSQL 16** as the primary data store and **TypeORM** as the ORM.

## Key Subsystems
The backend `apps/api` is composed of tightly encapsulated bounded contexts:

### Identity, Access & System Admin
- **`AccountsModule`**: Manages the overarching system accounts and triggers tenant provisioning.
- **`AuthModule`**: Handles JWT issuance, validation, and cross-tenant login capabilities.
- **`RbacModule`**: Houses the dynamic permission catalog and Role-Based Access Control logic (`@RequirePermissions`).
- **`TenantsModule`**: Exposes administrative endpoints for configuring hospital tenants.
- **`MasterDataModule`**: A centralized configuration store for Wards, Departments, Bed Types, and standard lookups.

### Clinical & Operations
- **`PatientsModule`**: Core demographic management and MPI (Master Patient Index) equivalent functionality.
- **`AppointmentsModule`**: Manages scheduling and provider availability.
- **`AdmissionsModule`**: Controls the ADT (Admission, Discharge, Transfer) workflow and bed allocations.
- **`ClinicalModule`**: Encompasses Vitals, Triage, and Encounters (Diagnoses, Prescriptions, Clinical Notes).
- **`OrdersModule`**: Manages clinical and non-clinical orders (Lab, Radiology, Dietary).
- **`BillingModule`**: Manages the financial lifecycle including Deposits, Invoices, and Payments.

### Observability & Asynchronous Processing
- **`AuditModule`**: Intercepts structural mutations via TypeORM lifecycle hooks and persists JSON-b serialized diffs to ensure HIPAA/compliance auditability.
- **`ReportingModule`**: An Event Archiver that intercepts critical business operations (e.g., OrderPlaced, PatientAdmitted) and normalizes them into a flat `reporting_events` schema for analytical dashboards.

## Cross-Cutting Concerns
- **Data Isolation**: We enforce data isolation natively at the Postgres level. Instead of threading `tenantId` into every WHERE clause, we leverage Node's `AsyncLocalStorage` via `@hospital/tenant-context` to automatically prefix `SET search_path TO "tenant_XYZ"` to every connection checking out of the TypeORM pool.
- **Error Handling**: Standardized HTTP Exceptions are bubbled up natively through NestJS global exception filters. Partial failures in BFF aggregation endpoints are gracefully degraded instead of throwing a generic 500 error.
