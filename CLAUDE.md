# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

HyperDev is a monorepo for **Hypergen** — a modern, scalable code generator with AI integration, built with TypeScript. It uses a multi-package architecture with oclif for CLI plugin composition.

## Package Architecture

The CLI is a thin oclif host. `drive`, `gen`, `kit`, and `hq` are plugins; `core` and `ui` are shared packages. Dependencies flow strictly left-to-right within that chain — `gen` → `kit` → `core` — and a plugin must not depend on the CLI host, because the CLI depends on the plugins (that would be circular).

| Package | Folder | Purpose |
|---------|--------|---------|
| `@hypercli/core` | `packages/core/` | Shared types, config, errors, parsers, utils. |
| `@hypercli/ui` | `packages/ui/` | Shared CLI presentation. |
| `@hypercli/kit` | `packages/kit/` | Kit lifecycle, source resolution. oclif plugin. |
| `@hypercli/gen` | `packages/gen/` | Recipe engine, Jig templates, AI 2-pass, actions. oclif plugin. |
| `@hypercli/drive` | `packages/drive/` | Hyperdrive spaces, manifest, warp, machine sync. oclif plugin. |
| `@hypercli/hq` | `packages/hq/` | HQ commands. oclif plugin. |
| `@hypercli/cli` | `packages/cli/` | Thin shell, plugin host. Provides `hyper` binary. |

## Monorepo Structure

```
hyperdev/
├── .moon/                    # Moon build system configuration
├── apps/
│   └── docs/                 # Mintlify documentation site
├── packages/
│   ├── core/                 # @hypercli/core
│   ├── ui/                   # @hypercli/ui
│   ├── kit/                  # @hypercli/kit
│   ├── gen/                  # @hypercli/gen
│   ├── drive/                # @hypercli/drive
│   ├── hq/                   # @hypercli/hq
│   ├── cli/                  # @hypercli/cli
├── hyper-kits/
│   └── nextjs/               # Next.js kit (git submodule)
├── agent/reports/            # AI agent work reports
└── .taskmaster/              # Task Master AI integration
```

## Essential Commands

### Package Management
- **Always use `bun`** — never npm
- `bun install` — install all workspace dependencies

### Building & Testing
```bash
# Per-package (from package dir)
bun run build                       # Build with the package's configured builder
bun run typecheck                   # Type-check
bun run lint                        # Biome
bun run test                        # Run tests
```

```bash
# Example, from the repo root
flock /tmp/hyper-heavy2.lock -c 'cd packages/drive && bun run build && bun run test'
```

### Machine setup test safety

- Any test or experiment that can reach `hyper machine setup` or an installer must use a temporary `HOME` and a separate, empty temporary `CLAUDE_CONFIG_DIR`. Never inherit the operator's home or hook selection.
- Render recipes for syntax checks; exercise their file operations offline with fake downloaders. A setup test must not download tools or edit the operator's rc files.
- Do not use loopback SSH to test provisioning: SSH restores the real account's home. Remote provisioning e2e belongs in a disposable container/account, not the operator's login.

### Key Technologies
- **Template engine**: Jig (Edge.js fork) — `.jig` files, NOT EJS
- **CLI framework**: oclif with plugin architecture
- **Build**: per-package (tsc for drive/cli; check each `package.json`)
- **Test**: vitest (compatible with bun test). vitest has NO `expect.skip()`: to skip a test from inside it, take the context (`it("…", (ctx) => ctx.skip("why"))`). An `expect.skip(...)` call throws `expect.skip is not a function` and fails the very test it meant to skip.
- **Monorepo**: bun workspaces + moon

### Hyperdrive test safety

- CLI-spawn tests execute built `dist/`, not the source Vitest imports. After drive changes, build `packages/drive` then `packages/cli` before running those tests.
- Every hyperdrive test or probe must use temporary spaces, local bare remotes, `HOME`, `HYPER_HOME`, `HYPER_DRIVE_CONFIG` and `XDG_CONFIG_HOME`. Never point tests at the operator's real home/config or hyperdrive. Keep git fault-injection shims on a fixture-private PATH and restore it in `finally`.
- Test terminal interruption with a detached process group and signals to the whole group, not only Node. `spawnSync` blocks JS signal callbacks: space init's scoped listeners prevent default parent termination; child `result.signal` drives rollback. Node-only signals during a synchronous child are not reliably observed.

## How the CLI Works

CLI is a thin oclif shell that loads drive, gen, hq, and kit as plugins:
- `hyper drive init` / `hyper space list` → routed to @hypercli/drive
- `hyper kit install` → routed to @hypercli/kit
- `hyper run nextjs crud` → routed to @hypercli/gen
- `hyper nextjs crud list` → gen's `command_not_found` hook rewrites to `hyper run`
- `hyper config show` → handled by @hypercli/cli directly

Hyperdrive's user config is read/written only through `packages/drive/src/config/index.ts`. The `main` manifest checkout is an ordinary clone at `~/.hyper/drive/` (path built only by `services/manifest.ts`); space branch git operations go through `services/space-git.ts` with explicit git-dir/work-tree.

Space init and daily commits share `services/space-sync.ts`: keep staging, gitlink exclusion, staged-blob secret checks and push classification there. Both generated commit paths are unsigned and hook-free. The async secret-content check retains at most the first 4 KB of each index blob, not the work-tree file, using one batch-check and one streaming batch reader (never per-file Git spawns). Await shared commit/publication helpers and preserve init's onCommitted rollback boundary. `space-history.ts` owns daily detection/fetch/pull/status/log; fetch only the current space branch, including for legacy git dirs with missing or broad fetch refspecs. Status is offline unless `--fetch` and compares the remote-tracking ref from the last contact (push counts too). Log passes through Git arguments and streams, except ref-expanding switches; do not replace that with a display-option allowlist.

Incoming history is untrusted. Pull and clone must await `validateIncomingSpace(root, tip, base?)` from `services/space-incoming.ts` before materialization, then use the returned immutable tip. It requires a byte-identical canonical incoming allowlist, validates the complete tip tree, rejects reserved paths from `RESERVED_PATHS`, `.git` components, gitlinks, `.gitmodules`, `.gitattributes`, and escaping/reserved symlink chains. `.hyper/memory` is legitimate space material; `.hyper/space.git` never is. Fast-forward uses `--no-overwrite-ignore`; merge disables signature verification and submodule recursion via config (`git merge` does not accept `--no-recurse-submodules`). Validate the TIP tree only: never walk incoming history, or old spaces become unclonable after a renderer change. Pull must never silently adopt a peer's new `tracked` entries (they widen what this machine uploads); require `--accept-tracked` or a TTY confirmation, count the local ignored files each entry would capture, and keep `.gitignore` and `hyper.tracked` in agreement in both directions. The tracking ref always means last SEEN, not last accepted; record refusals in `hyper.refusedTip`/`hyper.refusedReason` for `status`. `incomingReviewPaths(root, tip, base?)` reports (never blocks) added, changed **or deleted** executable/instruction paths: instruction filenames at any depth, everything under `.claude/`, `.cursor/`, `.codex/`, `.vscode/`, `.pi/`, `.hyper/memory/` and `bin/`, any changed executable, and the target of any reviewed symlink resolved inside the tip. Clone calls it with no base. The shared runner disables hooks/fsmonitor, read-only calls disable optional index locks, and successful pushes explicitly update their remote-tracking ref, even without a fetch refspec.

`space clone` treats the manifest and incoming branch as untrusted. Defaults may remap `/Users/<user>/`, `/home/<user>/` or `/root/` into the current HOME, but must remain inside HOME (including symlink resolution), contain no dot-prefixed segment below HOME, and not start at `~/Library`. They require TTY confirmation or `--yes`; an explicit path skips this policy but reports a symlinked parent. Validate the complete selected manifest entry before creating/fetching a space or project. Project transports are HTTPS/SSH only, with file/local allowed only for a local hyperdrive; enforce this in git as well as URL validation. Off-TTY, disable credential prompts and add SSH BatchMode; on-TTY, inherit git progress/authentication without a spinner. Publish checked-out files exclusively and never register a preexisting file as rollback-owned. Before checkout, await the shared incoming validator and use its immutable tip and tracked list, warning when manifest tracking claims exceed the canonical allowlist. Write the space git config locally; never copy it from a branch. Report remote `.claude/` content except memory, `bin/`, `.config/`, and `CLAUDE.md`/`AGENTS.md`/`HYPER.md` at any depth in warnings and JSON. Clone's temporary classifier is to be replaced by shared `incomingReviewPaths` when available. Tracked files win byte-for-byte over generated scaffolding: call the packaged bash `write_hyper_md_*` only for an absent HYPER.md, and never regenerate tracked worktrunk configuration. Project git-dir writes are permitted only during clone provisioning; later space operations leave project repositories alone.

Worktree placement still requires the user's worktrunk setting `worktree-path = "{{ repo_path }}/../worktrees/{{ branch | sanitize }}"` (globally or per project). Clone checks placement through read-only `wt config show` / `wt step eval` and warns with the actual destination and suggested setting; it never edits user config or runs worktree hooks. Fresh-HOME tests must distinguish the configured strict-layout case from the unconfigured warning case.

**BaseCommand hierarchy**: oclif Command → CoreBaseCommand (cli) → GenBaseCommand (gen)

## Template System

Templates use **Jig** (Edge.js fork), NOT EJS:
- Files: `.jig` extension
- Syntax: `{{ variable }}`, `@if()/@end`, `@each()/@end`, `@let(x = expr)`
- Filters: `{{ camelCase :: name }}`
- Custom `@ai` tag for 2-pass AI generation
- YAML frontmatter with `to:`, `inject:`, `when:`, `after:` fields

## Recipe Engine

Recipes are YAML workflows with steps. 13 tool types: template, action, recipe, shell, prompt, ai, install, query, patch, ensure-dirs, sequence, parallel, conditional.

Key features:
- Topological sort for dependency resolution
- Parallel execution batches
- Step output piping via `exports` field
- `onSuccess`/`onError` message templates
- `install` tool auto-detects package manager

## Releasing

All packages share a single version (linked-versions via release-please).

```bash
# 1. Bump versions + regenerate oclif manifests
node scripts/bump-versions.mjs <version>

# 2. Update .release-please-manifest.json to match the new version

# 3. Commit version bump
git commit -m "chore: bump all packages to <version>"

# 4. Tag and push
git tag v<version> && git push && git push origin v<version>

# 5. Publish to npm (dry-run first!)
bash scripts/release.sh --dry-run
bash scripts/release.sh
```

The `release.sh` script publishes packages in dependency order and skips already-published versions. Release-please also runs via CI on push to main, but manual releases follow the steps above.

## Git Conventions

Commits follow conventional commit format:
```bash
git commit -m "feat(core): add new parser for cookbook.yml"
git commit -m "fix(gen): resolve template variable collision"
```

## Error Messages & User Experience

Use friendly, conversational language for error messages and user-facing output:

**Good:**
- "Uh oh! I couldn't find any command or hyper kit named `iniit`. Did you mean `init`?"
- "Here are the available commands and kits"

**Avoid:**
- "Unknown command"
- "Command not found"
- Dry, technical jargon

**Command Styling:**
- Use `styleCommand()` from `@hypercli/core/ui` to highlight commands consistently
- Commands are styled with hex color #4EC9B0 (matching the cli-html theme)
- Examples: `styleCommand("hyper init")`, `styleCommand("nextjs")`

**Message Types:**
- Use `error()` for actual errors (things that went wrong)
- Use `tip()` for helpful information (suggestions, available options)
- Use `warning()` for cautions (things that might cause issues)
- Use `success()` for confirmations (things that worked)
- Use `info()` for neutral information

## Important Notes

- `hyper-kits/nextjs/` is a **git submodule** — the only submodule in the repo
- The packages under `packages/` are NOT submodules — regular monorepo directories
- Tests live in each package's `tests/` directory
- TypeScript strict mode is disabled (to be re-enabled incrementally)
- DTS generation is disabled (inflection types issue — to be fixed)

---

# Mintlify Documentation Standards

**For the main HyperDev documentation site in `apps/docs/`**

## Working relationship
- Push back on ideas when warranted — cite sources and explain reasoning
- ALWAYS ask for clarification rather than making assumptions
- NEVER lie, guess, or make up information

## Project context
- Format: MDX files with YAML frontmatter
- Config: `apps/docs/docs.json` for navigation, theme, settings
- Dev server: `cd apps/docs && mintlify dev`

## Content strategy
- Document just enough for user success
- Prioritize accuracy and usability
- Search for existing content before adding new — avoid duplication
- Check existing patterns for consistency

## Writing standards
- Second-person voice ("you")
- Prerequisites at start of procedural content
- Test all code examples before publishing
- Language tags on all code blocks
- Alt text on all images
- Relative paths for internal links
- Frontmatter required: `title` and `description`

## Git workflow
- NEVER use --no-verify when committing
- NEVER skip or disable pre-commit hooks
- Create a new branch when no clear branch exists
- Commit frequently
