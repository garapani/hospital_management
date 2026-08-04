---
name: resolve-pending-task
description: Use when picking up the next unblocked item from new/docs/technical-design/pending-tasks.md, to route it through this repo's established brainstorm -> plan -> execute -> docs pipeline.
---

# Resolve Pending Task

Pick up the next unblocked item in `new/docs/technical-design/pending-tasks.md` and run it through
this repo's established pipeline. See the repo-root `CLAUDE.md`'s "The Pending-Task Pipeline"
section for the four-stage shape this encodes — this skill is the operational checklist for
actually doing it.

## Step 1: Find the next unblocked item

Read `new/docs/technical-design/pending-tasks.md` in full, in order (Phase 0 through Phase 6 —
phases are already priority-ordered, don't re-sort them). Find the first `- [ ]` / unchecked,
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

- **No spec exists yet:** invoke `superpowers:brainstorming` to design the solution. It will
  itself handle writing `new/docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and committing
  it, and hands off to `superpowers:writing-plans` once the user approves the spec.
- **Spec exists, no plan yet:** invoke `superpowers:writing-plans` directly against the existing
  spec file to produce `new/docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- **Plan exists, not (fully) executed:** invoke `superpowers:subagent-driven-development` against
  the existing plan. Check the plan file's own `- [ ]` checkboxes and `.superpowers/sdd/<topic>/`
  (progress notes, task reports, review diffs) to figure out which tasks are already done versus
  which to resume from — don't restart completed tasks.

Do not skip stages: a plan should not be hand-written without a preceding brainstormed-and-approved
spec, and code should not be written without a preceding reviewed plan, even under time pressure.

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
