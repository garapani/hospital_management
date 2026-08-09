---
name: resolve-pending-task
description: Use when picking up the next unblocked item from new/docs/technical-design/pending-tasks.md, to route it through this repo's MVP fast track or heavyweight brainstorm -> plan -> execute -> docs pipeline, whichever applies.
---

# Resolve Pending Task

Pick up the next unblocked item in `new/docs/technical-design/pending-tasks.md` and run it through
the pipeline that applies to it. See the repo-root `CLAUDE.md`'s "The MVP Fast Track" and "The
Heavyweight Pipeline" sections for the two shapes this encodes — this skill is the operational
checklist for actually doing it.

## Step 1: Find the next unblocked item

Read `new/docs/technical-design/pending-tasks.md` in full, in order. **The "MVP hardening (fast
track)" section at the top jumps the queue while the MVP push is active** — check it first,
regardless of what's checked/unchecked further down in Phase 0 through Phase 6 (which remain
priority-ordered among themselves, don't re-sort those). Find the first `- [ ]` / unchecked,
un-numbered-bullet item that is not blocked:

- Cross-check the "Dependencies worth calling out explicitly" section at the bottom of the file —
  an item can be unchecked but explicitly blocked on something else unresolved (e.g. Phase 1 item 3
  is blocked on the tenant-migration-runner gap). Skip blocked items even if they sort earlier.
- An item with an existing but not-yet-executed spec/plan (check
  `new/docs/superpowers/specs/` and `new/docs/superpowers/plans/` for a matching
  `YYYY-MM-DD-<topic>*.md`, and `.superpowers/sdd/YYYY-MM-DD-<topic>/` for partial execution
  artifacts) is still "the next item" — don't re-brainstorm or re-plan work that's already been
  designed, just resume the pipeline at the stage it left off. Check `git log` and the plan file's
  own checkbox state to determine what has actually landed versus what's still pending.
- Read the linked evidence in `new-features.md` (gap description) and `review-comments.md`
  (file:line findings) for the chosen item before proposing anything — the pending-tasks.md entry
  itself is a one-line pointer, not the full spec.

## Step 2: Confirm scope with the user before starting

This repo's established rhythm is **one item at a time, with a checkpoint** — not batching
multiple `pending-tasks.md` items into a single session. Before invoking any pipeline skill:

- State which item you've identified as next-unblocked, and why (cite the phase/number and any
  dependency reasoning from Step 1).
- If a spec and/or plan already exists for it, say so and propose resuming there instead of
  starting over.
- Get explicit confirmation before proceeding — don't assume "continue" from earlier in the
  session covers a new pending-tasks.md item unless the user's intent is unambiguous.

## Step 3: Route into the pipeline

**First, determine which track the item is on**: anything in `pending-tasks.md`'s "MVP hardening
(fast track)" section uses the MVP fast track below; everything else uses the heavyweight pipeline.
Within a track, do not skip stages even under time pressure — the fast track is already the
lighter-weight option, there's no lighter-still shortcut beneath it.

### MVP fast track

- **No spec exists yet:** write one directly per `CLAUDE.md`'s "The MVP Fast Track" step 1
  (`mattpocock-skills:to-spec`'s template, no brainstorming-skill interview), save to
  `new/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, commit it.
- **Spec exists, not implemented:** invoke `mattpocock-skills:implement` (which uses
  `mattpocock-skills:tdd` at test seams) directly against the spec — no separate plan doc, no
  per-task subagent dispatch.
- **Implementation done, not reviewed:** run risk-gated security review (only if the item touches
  auth/tenant-isolation/PHI/money) plus `mattpocock-skills:code-review` (always), per `CLAUDE.md`'s
  fast-track step 4.

### Heavyweight pipeline

- **No spec exists yet:** invoke `superpowers:brainstorming` to design the solution. It will
  itself handle writing `new/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and committing
  it, and hands off to `superpowers:writing-plans` once the user approves the spec.
- **Spec exists, no plan yet:** invoke `superpowers:writing-plans` directly against the existing
  spec file to produce `new/docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- **Plan exists, not (fully) executed:** invoke `superpowers:subagent-driven-development` against
  the existing plan. Check the plan file's own `- [ ]` checkboxes and `.superpowers/sdd/<topic>/`
  (progress notes, task reports, review diffs) to figure out which tasks are already done versus
  which to resume from — don't restart completed tasks.

Do not skip stages within whichever track applies: on the heavyweight pipeline, a plan should not
be hand-written without a preceding brainstormed-and-approved spec, and code should not be written
without a preceding reviewed plan.

## Step 4: Verify the closing docs update landed

The last task of every plan (per this repo's convention) updates, in one commit:

- `new/docs/technical-design/pending-tasks.md` — the item's checkbox flips to `[x]` with a short
  "done: ..." summary of what actually shipped.
- `new/docs/technical-design/review-comments.md` — the originating finding gets a **Resolved:**
  note added directly under its heading, pointing at the plan file. The finding text itself is
  never deleted.
- `new/docs/technical-design/Development-Standards.md` — a new or updated section documenting the
  pattern this work established, for future work to follow without re-deriving it.

If the executed plan's final task didn't do all three, do it now before considering the item done.

## Git conventions (same as the rest of this repo)

Conventional commit prefixes, never `--amend`, no AI co-authorship trailer, work directly on
`main`. See the repo-root `CLAUDE.md` for the full statement of these conventions.
