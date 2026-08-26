# DICOM scoping note

Status: **scoping only — no implementation until a human approves scope.**
Origin: `pending-tasks.md` / `claude-code-tasks.md` §2.10 (Phase 6).

## What DICOM is, separately from Radiology

The existing `radiology` module (`apps/api/src/radiology/`) covers the **order/report**
workflow: `RadiologyRequisition` (order, status, scheduling, cancellation reason),
`RadiologyImagingType`/`RadiologyImagingItem` (catalog), and a PDF report mirrored via
`@hospital/object-storage` (`radiology-report-document.ts`, same pattern as Lab). None of
that models the imaging pixel data itself — DICOM is the separate concern of storing and
viewing the actual **studies/series/images** a modality (X-ray, CT, MRI, ultrasound
machine) produces, and is a distinct bounded context in the legacy app (`ServerModel/DICOMModels`,
`Controllers/DicomViewer/DicomController.cs` — see PRD §100/§253).

## How the legacy app did it (reference only, not a parity contract)

- A **separate PACS-facing SQL Server database** (`connStringPACSServer`, `DicomDbContext`),
  not the main hospital DB — three tables: `PatientStudies` (1 row per study — patient,
  `StudyInstanceUID`, `Modality`, `StudyDescription`, `StudyDate`), `Series` (1 row per
  series, FK to study), `DicomFiles` (1 row per image, **binary DICOM file bytes stored
  directly in a SQL column**, FK to series).
- A REST-ish controller (`GET /api/Dicom?reqType=getStudies|getSeriesImageInfo|...`)
  that queries those tables and streams file bytes back (`GetDicomImage`).
- An Angular/Cornerstone.js WADO-style in-browser viewer
  (`shared/danphe-dicom-viewer/`) that requests studies → series → images and renders
  pixel data client-side.
- No `TenantId` column exists on any of the legacy models — tenant scoping in the old app
  is implicit via the separate PACS DB connection string per install, which does not map
  onto this repo's shared-Postgres-per-tenant-schema model at all.

This confirms DICOM was already architecturally separate in the old system (its own DB),
so treating it as a separate bounded context here is consistent, not a new split.

## Open scope questions for the human

1. **Ingest path** — do modalities push studies to us (DICOM C-STORE / a PACS server we'd
   have to stand up), or is this pull/upload-only (radiographer uploads a study file after
   acquisition)? A real PACS integration (C-STORE, DICOMweb/WADO-RS) is materially bigger
   scope than "attach files to a requisition."
2. **Storage** — binary blobs in Postgres (legacy approach) is a known anti-pattern at our
   scale; the rest of this codebase already standardized on MinIO via
   `@hospital/object-storage` (`putObject`/`getObject`/`removeObject`/`presignedGetUrl`,
   `libs/object-storage/src/lib/object-storage.service.ts`) keyed
   `<domain>/<tenantId>/<filename>`. Proposal: reuse that, e.g.
   `dicom/<tenantId>/<studyInstanceUid>/<sopInstanceUid>.dcm`, with `study`/`series`/`image`
   metadata (UIDs, modality, description, date) in normal tenant-schema Postgres rows —
   not raw bytes in a DB column.
3. **Link to Radiology** — is a DICOM study required to hang off a
   `RadiologyRequisition` (1 requisition → studies), optional/standalone, or both? Affects
   whether `radiology_requisitions` gets a nullable link column or DICOM stays fully
   independent.
4. **Viewer** — in-browser DICOM rendering (Cornerstone.js or a modern equivalent) is a
   nontrivial frontend investment on its own; is Phase 6 scope "store + list + download"
   or "store + list + render pixels in-app"?
5. **Users/workflows** — who initiates (radiographer uploads post-acquisition; radiologist
   views for reporting)? Does viewing require its own permission distinct from
   `radiology.requisitions.*`, given DICOM images are separately sensitive PHI?

## Recommendation (non-binding, for discussion)

Start with the narrowest useful slice: tenant-scoped `dicom_studies`/`dicom_series`/
`dicom_images` metadata tables (mirroring the legacy shape minus the binary column) +
MinIO-backed file storage via the existing `ObjectStorageService`, upload-only ingest
(no live PACS listener), optional link to a `RadiologyRequisition`, and a
download/presigned-URL flow rather than an in-browser pixel viewer for v1. That defers
the two most expensive unknowns (a real PACS listener, a DICOM rendering viewer) to a
later phase once the metadata/storage model is validated.

## Non-goals for this note

No entities, migrations, DTOs, services, or frontend code are added by this note. Nothing
in `TENANT_MIGRATIONS`/`PLATFORM_MIGRATIONS` changes. Implementation starts only after the
human picks answers to the open questions above.
