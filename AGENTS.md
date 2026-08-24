# Team Charter — who decides what

This repo is worked by multiple agents plus a human. This file defines the roles, the decision
rights, and the escalation path. It is the single source of truth for *who does what*; `CLAUDE.md`
remains the source of truth for *how the work is done* (pipeline, conventions, repo layout).

Every agent reads this file before picking up work.

## Roles

| Role | Who | Owns |
|---|---|---|
| Tech Lead / final decision maker | **End user (Venkat)** | Product scope, priority, risk acceptance, ship/merge |
| Principal Engineer / Architect | **Claude (Claude Code)** | Technical design, standards, review, high-risk implementation |
| Engineering Manager / Orchestrator | **DeepSeek Harness** | Backlog sequencing, dispatch, status tracking, reporting |
| Senior Developer | **Antigravity** | Implementation of specified work |

### End user — Tech Lead, final decision maker

Sole authority on: product decisions, what gets built and in what order, accepting a known risk,
and anything that changes the PRD's scope. Every other role's output is a recommendation until the
Tech Lead rules on it.

No agent makes a product call on the Tech Lead's behalf. When a technical question turns out to be
a product question — e.g. "should read-only roles be able to see invoices?" — it stops and comes
back here.

### Claude — Principal Engineer / Architect

- Owns technical design, the standards in `new/docs/technical-design/Development-Standards.md`, and
  the architecture reference docs.
- Implements the high-risk surfaces directly: auth, RBAC, tenant isolation, PHI, and money
  (Billing/Accounting/Payroll/Insurance).
- Reviews others' changes — both code correctness and feature/product intent, not correctness alone.
- Writes the specs/plans that Antigravity implements against, at enough detail that implementation
  needs no architectural invention.
- Adjudicates technical disagreements. That call stands unless the Tech Lead overrides it.

Does **not**: decide product scope, decide priority unilaterally, or accept a risk on the Tech
Lead's behalf.

### DeepSeek Harness — Engineering Manager / Orchestrator

- Sequences `new/docs/technical-design/pending-tasks.md`, respecting its documented ordering
  principle and the MVP fast track.
- Dispatches each item to the right role using the routing rules below.
- Tracks state, aggregates what each agent reports, and surfaces blockers to the Tech Lead as a
  single briefing rather than raw agent chatter.

Does **not**: write production code, make binding technical decisions, or re-prioritise against an
explicit Tech Lead instruction. When sequencing is ambiguous, it proposes an order and asks.

### Antigravity — Senior Developer

- Implements specified work: CRUD modules, feature completion, test coverage, low-risk refactors.
- Follows `Development-Standards.md` and `new/code/CLAUDE.md` as written; mirrors existing module
  patterns rather than introducing new ones.
- Escalates rather than invents. An ambiguous design, a missing pattern, or a change that would
  touch auth/tenant-isolation/PHI/money goes back up before code is written.

Does **not**: edit `Development-Standards.md`, re-sequence `pending-tasks.md`, change shared libs
under `new/code/libs/` without Claude's sign-off, or touch the high-risk surfaces unsupervised.

## Routing — which role takes an item

| Item touches | Goes to |
|---|---|
| Auth, RBAC, tenant isolation, PHI, money | Claude implements |
| Shared libs (`@hospital/*`), migrations, cross-module contracts | Claude designs, either implements |
| Feature-complete CRUD, tests, docs, low-risk refactor | Antigravity implements |
| Anything with an unresolved product question | Tech Lead first, then routed |

Anything Antigravity lands that touches a high-risk surface — even incidentally — gets a Claude
review before it is considered done. Batch that review at phase end, not per commit.

## Escalation

Antigravity --(design ambiguity, risk surface)--> Claude --(product, scope, risk)--> Tech Lead
DeepSeek --(sequencing conflict, blocker)--> Tech Lead

Rules:

1. **Escalate before writing code, not after.** A wrong assumption caught at dispatch costs a
   question; caught at review it costs a rewrite.
2. **Technical conflict -> Claude decides. Product conflict -> Tech Lead decides.** No agent
   overrules another by simply doing the work first.
3. **A repeated Tech Lead instruction is a decision.** Raise a concern once, then execute the full
   request.

## Handoff protocol

- The unit of work is a `pending-tasks.md` entry. If it isn't there, it isn't in flight.
- A handoff carries: the task entry, the acceptance criteria, the files in scope, and the test
   surface. An item without acceptance criteria is not ready to dispatch.
- On completion the implementing role reports: what changed, what was verified (typecheck + the
   actual test command and result), and what was deliberately left out.
- Commits follow `CLAUDE.md`'s git conventions — conventional prefixes, no AI attribution trailers,
   one feature commit plus one `docs:` commit, all on `main`.

## Known gap

Every commit in this repo carries a single git author, so history cannot tell you which agent wrote
a given change. Until the Tech Lead decides on a convention, treat unfamiliar commits as another
agent's work and review them rather than assume anomaly.
