# Patient Management Module — Design Spec

**Status:** Approved
**Date:** 2026-07-31
**Scope:** Phase 1 Core Clinical + Revenue — Patient Registration, Demographics, Next-of-Kin, Duplicate Detection, and Tenant-Scoped MRN Generation.

---

## 1. Overview & Business Goals

The Patient Management module (`PatientsModule`) lives inside `apps/api` (`src/patients`). It provides centralized patient master record management across all hospital tenants.

### Key Capabilities
- **MRN Generation**: Monotonic, tenant-scoped auto-incrementing Medical Record Number (e.g. `PAT-2026-00001`).
- **Patient Registration & Demographics**: Store full patient personal details, blood group, government identification (Aadhaar, Passport, Voter ID, PAN, etc.).
- **Sub-Entities**: Normalized `PatientAddress` and `PatientKin` (next-of-kin / emergency contact) entities.
- **Duplicate Prevention**: Soft duplicate detection based on phone number or `(firstName, lastName, dateOfBirth)` with an explicit override flag (`allowDuplicate: true`).
- **RBAC Gating**: Secured via `@RequirePermission('patients.read')`, `'patients.create'`, `'patients.update'`, `'patients.manage'`.
- **Audit Logging**: Integrated with `@hospital/audit-emitter` for change tracking on patient master records.

---

## 2. Domain Entities & Database Schema

All entities belong to the per-tenant schema (`tenant_<hospitalId>`) and are created via a per-tenant TypeORM migration.

### 2.1 Entity Models

#### `Patient` (Table: `patients`)
| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | No | Primary Key (`gen_random_uuid()`) |
| `patientNo` | varchar(50) | No | Unique Medical Record Number (MRN) |
| `firstName` | varchar(100) | No | First name |
| `middleName` | varchar(100) | Yes | Middle name |
| `lastName` | varchar(100) | No | Last name / surname |
| `gender` | varchar(20) | No | `Male`, `Female`, `Other`, `Unknown` |
| `dateOfBirth` | date | Yes | Birth date |
| `age` | varchar(20) | Yes | Display age (e.g. "34Y 2M") if DOB exact date unknown |
| `phoneNumber` | varchar(20) | Yes | Primary contact phone number |
| `email` | varchar(150) | Yes | Email address |
| `bloodGroup` | varchar(10) | Yes | e.g. `A+`, `O-`, `B+` |
| `governmentIdType` | varchar(50) | Yes | e.g. `Aadhaar`, `PAN`, `Passport`, `VoterID` |
| `governmentIdNumber` | varchar(100) | Yes | Government ID number |
| `isActive` | boolean | No | Default `true` (soft deletion) |
| `createdAt` | timestamptz | No | Record creation timestamp |
| `updatedAt` | timestamptz | No | Record update timestamp |

#### `PatientAddress` (Table: `patient_addresses`)
| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | No | Primary Key |
| `patientId` | uuid | No | Foreign Key -> `patients(id)` |
| `addressType` | varchar(20) | No | `home`, `work`, `temporary`, `permanent` |
| `streetAddress` | varchar(255) | Yes | Street address line |
| `city` | varchar(100) | Yes | City / Town |
| `state` | varchar(100) | Yes | State / Province |
| `postalCode` | varchar(20) | Yes | PIN / Postal Code |
| `country` | varchar(100) | No | Default `'India'` |

#### `PatientKin` (Table: `patient_kins`)
| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | No | Primary Key |
| `patientId` | uuid | No | Foreign Key -> `patients(id)` |
| `kinName` | varchar(150) | No | Full name of next of kin / contact |
| `relationship` | varchar(50) | No | e.g. `Spouse`, `Parent`, `Sibling`, `Child`, `Guardian` |
| `phoneNumber` | varchar(20) | No | Contact phone number |
| `email` | varchar(150) | Yes | Contact email |
| `address` | varchar(255) | Yes | Address of next of kin |

#### `PatientSequence` (Table: `patient_sequences`)
| Column | Type | Nullable | Description |
|---|---|---|---|
| `prefix` | varchar(20) | No | Primary Key (e.g. `'PAT'`) |
| `year` | integer | No | Primary Key (e.g. `2026`) |
| `lastSequence` | integer | No | Counter value for current year sequence |

---

## 3. Core Business Workflows & Interfaces

### 3.1 Patient MRN Generation (`PatientNumberGeneratorService`)
- Formats MRN as `{PREFIX}-{YYYY}-{SEQUENCE:5}` (e.g. `PAT-2026-00001`).
- Uses atomic database lock/upsert on `patient_sequences` within the current tenant schema to guarantee monotonic sequence incrementing under concurrent registrations.

### 3.2 Duplicate Detection (`checkDuplicates`)
Before creating a patient record:
- Query `patients` where `phoneNumber = :phoneNumber` OR (`firstName = :firstName` AND `lastName = :lastName` AND `dateOfBirth = :dateOfBirth`).
- If matching active patients exist and DTO `allowDuplicate` is `false` (or unset), throw a `409 Conflict` containing the list of matching candidate patient records (`{ statusCode: 409, message: 'Potential duplicate patient records found', duplicates: [...] }`).
- If `allowDuplicate: true` is passed in the creation payload, proceed with registration.

### 3.3 Patient CRUD & Search (`PatientsService`)
- `create(dto: CreatePatientDto)`: Runs duplicate check, generates MRN, saves `Patient`, `PatientAddress`, `PatientKin` in a single transaction.
- `findAll(query: SearchPatientsDto)`: Supports searching by MRN (`patientNo`), name substring, phone number, government ID with pagination.
- `findOne(id: string)`: Retrieves patient along with addresses and next-of-kin list.
- `update(id: string, dto: UpdatePatientDto)`: Updates patient details, addresses, and kin contacts.
- `deactivate(id: string)`: Sets `isActive = false`.

---

## 4. REST API Specification (`PatientsController`)

Base Path: `/api/patients`

| Method | Path | Permission Required | Description |
|---|---|---|---|
| `POST` | `/` | `patients.create` | Register a new patient |
| `GET` | `/` | `patients.read` | Search & list patients (query params: `q`, `phoneNumber`, `patientNo`, `page`, `limit`) |
| `POST` | `/check-duplicates` | `patients.read` | Explicitly check potential duplicate patient records |
| `GET` | `/:id` | `patients.read` | Get patient details by ID |
| `PATCH` | `/:id` | `patients.update` | Update patient record |
| `DELETE` | `/:id` | `patients.manage` | Soft-deactivate patient record |

---

## 5. Security & RBAC Permissions

Platform RBAC catalog update (seeded into `public.permissions` and assigned to `Hospital Admin`, `Receptionist / Front Desk`, `Doctor`, `Nurse`):
- `patients.read`: View patient master records and search catalog.
- `patients.create`: Register new patients.
- `patients.update`: Modify patient demographics, addresses, and kin details.
- `patients.manage`: Deactivate patient records or administrative overrides.

---

## 6. Testing Strategy

1. **Unit Tests**:
   - `PatientNumberGeneratorService` formatting & counter logic.
   - `PatientsService` duplicate detection logic (triggering 409 vs allowed override).
2. **Integration Tests (`.integration-spec.ts`)**:
   - `Patient` entity CRUD and schema migrations across two test tenant schemas.
   - Concurrent MRN generation test ensuring zero duplicate numbers.
   - End-to-end `PatientsController` HTTP tests using supertest with JWT bearer auth and permission gating.
