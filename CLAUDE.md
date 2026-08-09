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

## The MVP Fast Track

As of 2026-08-09, `pending-tasks.md`'s "MVP hardening (fast track)" section (Billing
settlement/return + auto charge-capture, Appointments doctor-schedule endpoints, Admissions
discharge-summary artifact — see `mvp-status.md` for how these were identified) is being worked
under a **lighter** pipeline than the heavyweight one below, because the full four-stage ceremony
(brainstorm-interview → separate spec doc → separate plan doc → one subagent dispatch per task) was
costing more tokens/time than these items warrant. This track exists **alongside**, not instead of,
the heavyweight pipeline — see "The Heavyweight Pipeline" below for everything else in
`pending-tasks.md`.

One item at a time, still confirm scope with the user before starting:

1. **Write a spec directly into the conversation** using `mattpocock-skills:to-spec`'s template
   (Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions /
   Out of Scope) — no brainstorming-skill interview, synthesize from what's already been discussed.
   Save it to `new/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (same location/naming as the
   heavyweight track, so both tracks share one paper trail) and commit it.
2. **Implement directly** via `mattpocock-skills:implement`, using `mattpocock-skills:tdd` at test
   seams — no separate plan doc, no per-task subagent dispatch. Typecheck and run affected tests
   regularly; run the full suite once at the end.
3. **Test rigor scales to risk, not uniform depth**: full `TenantTestContext`-based integration
   specs (matching the existing codebase pattern) for anything touching tenant isolation, money
   (Billing), or clinical sign-off fields; lighter/unit-level tests are fine for low-risk CRUD.
4. **Security/quality review is risk-gated, not automatic**: run `security-review` or `/code-review`
   at `high` effort only for items touching auth, tenant isolation, PHI, or money (Billing
   qualifies; a pure Appointments/Admissions CRUD gap likely doesn't) — plus
   `mattpocock-skills:code-review` (Standards + Spec) always, since that one's cheap.
5. **Commit granularity**: one feature commit for the implementation, one separate `docs:` commit
   for the closing docs update (same three files as the heavyweight track's step 4, still never
   skipped) — not one commit per task.

## The Heavyweight Pipeline

Every item resolved from `pending-tasks.md` outside the MVP fast track above goes through the same
four-stage pipeline, one item at a time (not batched — confirm scope with the user before
starting):

1. **Brainstorm a design** via the `superpowers:brainstorming` skill → write a spec to
   `new/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, commit it.
2. **Turn the spec into a plan** via the `superpowers:writing-plans` skill → task-by-task
   implementation plan at `new/docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, commit it. Plans
   copy exact values (versions, tag vocabularies, allow-lists, etc.) verbatim from the spec into a
   "Global Constraints" section, and size tasks to be independently testable/reviewable — see
   `new/docs/superpowers/plans/2026-08-03-jwt-request-authentication.md` and
   `new/docs/superpowers/plans/2026-08-04-nx-module-boundary-enforcement.md` as the fullest recent
   examples of this shape.
3. **Execute the plan** via the `superpowers:subagent-driven-development` skill: a fresh subagent
   per task, task-level spec+quality review, fix loops, then a final whole-branch security/quality
   review on the most capable model, then a fix wave for whatever it finds. That skill's own file
   is the authority on its mechanics — this doc is a pointer, not a restatement.
4. **The final task in every plan** updates three docs in the same commit: checks off the item in
   `pending-tasks.md`, marks the originating finding resolved in `review-comments.md` (without
   deleting it), and adds/updates a section in `Development-Standards.md` documenting the new
   pattern.

Look at `git log --oneline` for how this becomes actual commit history: roughly one commit per
task-level step group, conventional-commit prefixes, no AI co-authorship.

## Git Conventions

- Conventional commit format (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc.).
- Never `git commit --amend` — always a new commit, even for a one-line fix.
- Never add a `Co-Authored-By: Claude` (or any AI attribution) trailer to any commit.
- All work happens directly on `main` — no feature branches or worktrees for this project's
  pending-task pipeline.
