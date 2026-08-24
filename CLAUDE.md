# new_hospital

Greenfield NestJS/Nx modular-monolith re-platform of the legacy ASP.NET Core "Danphe EMR"
hospital system, targeting the India hospital market. `new/docs/technical-design/PRD.md` is the
source of truth for scope and product phasing — read it, don't take this file's word over it.

## Repo Layout

- **`new/docs/technical-design/`** — the living planning/standards docs:
  - `PRD.md` — product requirements, source of truth for scope/phasing.
  - `Development-Standards.md` — coding conventions, architecture rules, testing standards; gets a
    new section every time a pending-task pipeline run establishes a new pattern.
  - `pending-tasks.md` — the prioritized backlog, sequenced by dependency and risk (security gaps
    first, then guardrails, ops-readiness, feature completion, net-new platform work, then the
    multi-quarter product backlog last) — **except the "MVP hardening (fast track)" section, which
    jumps the queue** while the MVP push is active (see "The MVP Fast Track" below). Read its
    "Ordering principle" and "Dependencies worth calling out explicitly" sections before picking up
    new work.
  - `mvp-status.md` — point-in-time audit of what's actually built vs. `PRD.md`'s phase scope
    (written because `pending-tasks.md` only tracks work from PRD Phase 2 onward — Phase 0/1
    modules predate that file's tracking regime and never got checklist entries). Re-run this audit
    rather than trust it blindly once enough MVP-track items have landed that the picture may have
    shifted.
  - `new-features.md` / `review-comments.md` — the gap list and file:line evidence that
    `pending-tasks.md` sequences. Findings in `review-comments.md` are marked resolved in place
    when fixed, never deleted — it's a historical record.
  - `Deployment-Guide.md`, `Runbook.md`, `Technical-Design.md` — deployment/ops/architecture
    reference docs, kept in sync with `new/code` as it evolves.
  - `claude-code-tasks.md` — actionable task backlog for Claude Code sessions (in-flight work,
    pending tasks, cleanups, improvements, each with context/what-to-do/verify/test). Start here
    when picking up development work; it supersedes this file for task sequencing.
- **`new/docs/superpowers/specs/`** and **`new/docs/superpowers/plans/`** — the design/implementation
  pipeline output for every `pending-tasks.md` item resolved so far (see below). Filenames follow
  `YYYY-MM-DD-<topic>-design.md` (specs) and `YYYY-MM-DD-<topic>.md` (plans).
- **`new/code/`** — the actual Nx monorepo (`apps/api`, `libs/*` as `@hospital/*` packages). See
  `new/code/CLAUDE.md` for its conventions (TypeScript/module-resolution quirks, protected-config
  handling, workspace layout) — that file is authoritative for anything under `new/code`; don't
  duplicate or second-guess it here.
- **`old/`** — the legacy ASP.NET Core system (`old/hospital-management-emr`), present on disk but
  currently **untracked** in this repo's git history (`git status` shows `?? old/`). Reference-only
  for understanding domain scope and legacy DB-field shapes — explicitly **not** a parity contract;
  the PRD and the specs/plans pipeline are what defines what actually gets built.

## The Development Pipeline

All work from `pending-tasks.md` follows a unified, lightweight pipeline focused on rapid delivery
with safety gates. One item at a time; confirm scope with the user before starting:

1. **Brainstorm scope in conversation** — clarify the problem, user stories, constraints, and test
   surface (don't write a separate spec doc; keep the discussion in chat).
2. **Implement via TDD** in the current session using test-driven development at test seams.
   Typecheck and run affected tests regularly; run the full suite once at the end.
3. **Test rigor scales to risk, not uniform depth**: full `TenantTestContext`-based integration
   specs (matching the existing codebase pattern) for anything touching tenant isolation, money
   (Billing), or clinical sign-off fields; lighter/unit-level tests are fine for low-risk CRUD.
4. **Security/quality review is risk-gated, not automatic**: run `security-review` or `/code-review`
   at `high` effort only for items touching auth, tenant isolation, PHI, or money (Billing
   qualifies; a pure Appointments/Admissions CRUD gap likely doesn't).
5. **Commit granularity**: one feature commit for the implementation, then one separate `docs:`
   commit updating three files: checks off the item in `pending-tasks.md`, marks the originating
   finding resolved in `review-comments.md` (without deleting it), and adds/updates a section in
   `Development-Standards.md` documenting the new pattern.

Look at `git log --oneline` for how this becomes actual commit history: roughly one commit per
task, conventional-commit prefixes, no AI co-authorship.

## Git Conventions

- Conventional commit format (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc.).
- Never `git commit --amend` — always a new commit, even for a one-line fix.
- Never add a `Co-Authored-By: Claude` (or any AI attribution) trailer to any commit.
- All work happens directly on `main` — no feature branches or worktrees for this project's
  pending-task pipeline.

## Team Charter

Roles and decision rights (Claude / Antigravity / DeepSeek Harness / Tech Lead) are defined in `AGENTS.md` at the repo root.
