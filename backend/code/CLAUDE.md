<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## Project-Specific Conventions (Hospital EMR Backend)

Lessons from building the shared libraries (`@hospital/tenant-context`, `@hospital/auth-guards`, `@hospital/audit-emitter`) — apply these to every future service in this monorepo.

### Process & Planning

- **Agent Workflows:** This file focuses strictly on code and workspace conventions. For agent workflows, including how and when to use the `superpowers:brainstorming` ("write spec") and `superpowers:writing-plans` ("write plan") skills (i.e. the Heavyweight Pipeline vs Fast Track), **always refer to the root `../../CLAUDE.md`**. It is the authoritative source for the project's task execution process.

### TypeScript / module resolution

- `tsconfig.base.json` uses `"module"`/`"moduleResolution": "nodenext"`, and every library's `package.json` declares `"type": "module"`. **Every relative import needs an explicit `.js` extension**, even though the source files are `.ts` (e.g. `from './foo.service'` → `from './foo.service.js'`). Jest's transform does not enforce this — only `tsc --build` (the `typecheck` target) does. Always run `pnpm exec nx run-many -t typecheck test`, not just `test`, before considering a change done.
- `experimentalDecorators` and `emitDecoratorMetadata` are enabled in `tsconfig.base.json`. Class decorators (`@Injectable()`) work under TypeScript's native decorator support without these flags, but **NestJS's constructor-parameter injection decorators (`@Inject()`) require them** — this wasn't discovered until the third library needed DI-by-token, so watch for `TS1206: Decorators are not valid here` on any new constructor-injected dependency.
- Under `isolatedModules` + `emitDecoratorMetadata`, a type-only value (an interface, not a class) referenced in a decorated constructor parameter's signature must be imported with `import type`, separately from any real runtime value imported from the same module (`TS1272` otherwise).

### Protected files — use explicit human sign-off, not a workaround

- `tsconfig*.json`, ESLint/Prettier/Biome/Stylelint config files are blocked from `Edit`/`Write`/`MultiEdit` by a repo-level hook (`guard-config.sh`) — this is intentional, to keep config drift out of casual agent edits. A legitimate change to one of these files needs the human's explicit go-ahead first.
- Destructive shell commands (`rm -rf`, `find -delete`, `git reset --hard`, force-push, etc.) are blocked by `guard-destructive.sh`. When a directory genuinely needs clearing and is verified safe (empty, untracked, or already captured in git history), use non-destructive primitives instead: `rmdir` on empty directories, plain `rm <file>` on individual files worked bottom-up. Don't reach for a different tool (e.g. Python's `shutil.rmtree`) to functionally replicate a blocked destructive command — that defeats the guard's purpose rather than working within its actual scope.

### Git hygiene

- **Never `git commit --amend`.** Always create a new commit, even for a one-line fix. Amending has previously silently absorbed an unrelated file into a prior, already-reviewed commit.
- **Never add a `Co-Authored-By: Claude` (or any AI attribution) trailer** to any commit — this repo's convention explicitly forbids it.
- **Frontend nested repository**: `frontend/` is its own independent git repo. Always run git commands for frontend work from within the `frontend/` directory (root `git add` ignores frontend paths).

### Workspace layout

- Monorepo tool: Nx (chosen over Turborepo for native `affected` detection and NestJS generators) — pnpm workspaces, package manager pinned via `packageManager` in `new/code/package.json`.
- Shared libraries live at `new/code/libs/<name>`, importable as `@hospital/<name>` (the `pnpm-workspace.yaml` `packages:` glob includes `libs/*`).
- When generating a new library via `nx g @nx/js:library`, **delete the generator's default scaffold files** (e.g. `foo.ts`/`foo.spec.ts`) once real implementation files exist — they're not meant to ship.
- A library that imports from another workspace library needs an explicit `"@hospital/<other-lib>": "workspace:*"` entry in its own `package.json` — TypeScript path mapping alone isn't sufficient for reliable resolution across libraries.
- CI (`new/code/.github/workflows/ci.yml`) only runs `test` and `typecheck` currently — `lint`/`build`/`e2e` are intentionally omitted (no ESLint config or build targets exist yet) rather than left in as silent no-ops. Add them back only once real targets exist for them.
