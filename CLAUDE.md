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
- Agent-user e2e: `packages/drive/tests/e2e/agent-user.sh` owns a disposable Podman container and temp SSH configuration. `KEEP=1` retains its container and logs for debugging; remove only the container name the script printed and confirm it is gone before handing off. Never pre-remove a name collision — that container was not started by this run. Standalone defaults to `hyper-fm-machine-t16`; `run.sh` supplies a per-run name, bound to 127.0.0.1, and a free port.
- Agent-user ACL policy lives in `services/machine/tasks/agent-acl.ts`: setup, its read-only check, and watcher sweeps/events must use the same generated rules. Private/traverse/read-only ACLs name the agent USER: group denies cannot override other matching group grants. Only work/projects stay group-based. A named-user deny still needs the zero-group/nonzero-other guard. Unowned protected entries and extra collab members must warn, not silently claim protection. Embed nested shell programs with `shellCommand`, never manual quote delimiters.
- Root must never touch agent-controlled paths, including metadata. Only the agent's `runuser` block may change its home. Shared-tree repairs select primary-owned non-symlink entries; agent-owned drift is reported, not escalated to root. Use the shared `find -execdir` mutation fragment with a safe PATH, physical-root bounds, and a fresh owner/symlink check before each write. These path checks are not atomic; never describe them as race-proof isolation. Never recurse (`setfacl -R`) into a shared tree or a shared config dir: prune, and never descend into, a directory this user does not own and cannot read. An agent-owned 0700 directory is a state the primary cannot repair, and a failure there must not abort the task — warn with a count and the first paths. Apply the home and config protection before repairing any shared tree, so a wedged shared tree can never suppress the privacy repair.
- Root-script sections are concatenated under one `set -euo pipefail`: a section never `exit 0`s (wrap it in a function and `return`), and every probe whose "no match" exit is the good case (`pgrep`, `grep`) is guarded with `|| true` inside the pipeline, or the script dies silently. Test a section by RUNNING the rendered text (see `tests/machine-home-path-script.test.ts`), not only by matching it. `tests/e2e/docker-home.sh` is the T-17 container e2e (privileged, uses its own unique container name); same rules as `agent-user.sh`.
- A repair acceptance test must require exit 0 and inspect the repaired state with the watcher stopped. `tests/e2e/run-agent-user-dirs.ts` invokes the real runner/task for that test; it is harness-only, never a shipped command.

### Key Technologies
- **Template engine**: Jig (Edge.js fork) — `.jig` files, NOT EJS
- **CLI framework**: oclif with plugin architecture
- **Build**: per-package (tsc for drive/cli; check each `package.json`)
- **Test**: vitest (compatible with bun test). vitest has NO `expect.skip()`: to skip a test from inside it, take the context (`it("…", (ctx) => ctx.skip("why"))`). An `expect.skip(...)` call throws `expect.skip is not a function` and fails the very test it meant to skip.
- **Monorepo**: bun workspaces + moon

### Hyperdrive test safety

- CLI-spawn tests execute built `dist/`, not the source Vitest imports. After drive changes, build `packages/drive` then `packages/cli` before running those tests.
- The aggregate drive e2e entry point is `packages/drive/tests/e2e/run.sh`: build the CLI first, then run it (it takes no heavy-command lock of its own, so `flock /tmp/hyper-heavy2.lock` around it is correct). It runs every `.sh` in a fixed order, each with its own short temp HOME, `SSH_AUTH_SOCK`/`SSH_AGENT_PID` removed and the real XDG dirs unset (the container scripts keep Podman's absolute XDG config/data paths and get unique container names on 127.0.0.1 with a free port). A temp HOME does NOT isolate ssh — OpenSSH reads `~/.ssh` from the PASSWD home — so every test ssh call must pass `-F /dev/null`, `IdentitiesOnly=yes IdentityAgent=none ForwardAgent=no ControlMaster=no ControlPath=none` and a fixture `UserKnownHostsFile`, plus an explicit `-i` where the harness owns a throwaway key (warp's, agent-user's, docker-home's); `sync.sh`'s wrapper has no throwaway key and falls back to ssh's default identity, which is why it also forces `IdentitiesOnly=yes`. warp's fake herdr substitutes those flags through the `%SSH_ISO%` placeholder and the script refuses to continue unless the rendered file really contains them. Never forward the operator's agent into a fixture. `sync.sh` exports `MUTAGEN_DATA_DIRECTORY` to a short `/tmp/hyperdrive-e2e-mutagen.*` directory (not its work dir: the daemon's unix socket must stay under the macOS path limit) and stops that daemon in cleanup, so it never touches the real daemon or the `claude-config`/`pi-config` sessions.
- Only `HYPER_E2E_SKIP` or the runner's documented capability probes may skip a script, and `HYPER_E2E_REQUIRE` turns such a skip into a FAIL so CI cannot go green as a no-op (the drive-e2e workflow requires every script it expects). Every skip prints a reason and is counted separately from passes. It is a separate `drive:e2e` moon task (`runInCI: false`), never part of `:test` or lefthook. On Linux Podman runs natively (no `podman machine`).
- `sessions.sh` is the one e2e that starts a REAL `claude -p` (C-18). It is opt-in: `run.sh` skips it with `SKIP sessions: real claude -p needs HYPER_E2E_REAL_CLAUDE=1` unless you export `HYPER_E2E_REAL_CLAUDE=1`; with that switch set but `CLAUDE_CONFIG_DIR` unset, the runner exits 2. Run it by hand on a real machine; never in CI or any shared run. Never run real Herdr commands from tests.
- Every hyperdrive test or probe must use temporary spaces, local bare remotes, `HOME`, `HYPER_HOME`, `HYPER_DRIVE_CONFIG` and `XDG_CONFIG_HOME`. Never point tests at the operator's real home/config or hyperdrive. Keep git fault-injection shims on a fixture-private PATH and restore it in `finally`.
- Test terminal interruption with a detached process group and signals to the whole group, not only Node. `spawnSync` blocks JS signal callbacks: space init's scoped listeners prevent default parent termination; child `result.signal` drives rollback. Node-only signals during a synchronous child are not reliably observed.

## How the CLI Works

CLI is a thin oclif shell that loads drive, gen, hq, and kit as plugins:
- `hyper drive setup` / `hyper space list` → routed to @hypercli/drive
- `hyper kit install` → routed to @hypercli/kit
- `hyper run nextjs crud` → routed to @hypercli/gen
- `hyper nextjs crud list` → gen's `command_not_found` hook rewrites to `hyper run`
- `hyper config show` → handled by @hypercli/cli directly

Hyperdrive's user config is read/written only through `packages/drive/src/config/index.ts`. The `main` manifest checkout is an ordinary clone at `~/.hyper/drive/` (path built only by `services/manifest.ts`); space branch git operations go through `services/space-git.ts` with explicit git-dir/work-tree.

Space init and daily commits share `services/space-sync.ts`: keep staging, gitlink exclusion, staged-blob secret checks and push classification there. Both generated commit paths are unsigned and hook-free. The async secret-content check retains at most the first 4 KB of each index blob, not the work-tree file, using one batch-check and one streaming batch reader (never per-file Git spawns). Await shared commit/publication helpers and preserve init's onCommitted rollback boundary. `space-history.ts` owns daily detection/fetch/pull/status/log; fetch only the current space branch, including for legacy git dirs with missing or broad fetch refspecs. Status is offline unless `--fetch` and compares the remote-tracking ref from the last contact (push counts too). Log passes through Git arguments and streams, except ref-expanding switches; do not replace that with a display-option allowlist.

Session-end saves use `space commit --session-end`: validate stdin before staging, stream transcript JSONL with a 1 MiB per-record cap (skip larger records), and cap the single-line summary at 200 Unicode code points. The command returns nonzero with one line on refusal; the plugin hook always exits zero and never pushes after a refused commit. Keep the shared commit guards, never pull, and never pass secret overrides automatically. With no CLI, the hook can only walk for `.hyper/space.git` to report its cadence; normal detection still uses the single packaged library. Test hooks only from temporary spaces with isolated homes/configs, never this repository's real space.

Claude Code gives SessionEnd hooks 1.5 s unless the user's own settings raise it, so the hook only finds the space, reads the cadence and starts a DETACHED worker (`space commit --session-end --payload-file <.hyper/space.git/session-end-payload.*>`, new session via `setsid`/perl `POSIX::setsid`, no inherited pipes). The worker is `services/session-end-worker.ts`: commit, push for `session-end+push` (bounded: 45 s commit-lock wait, 15 s push-lock wait, 30 s push with its process group killed, all within 120 s), one line in `.hyper/space.git/session-end.log` (rotated at 64 KiB), surfaced by `space status` when it failed. `clear`/`resume` reasons save nothing (matcher and worker both). Tests wait for the log line, not for the hook. Every writer of the space index (commit, pull's fast-forward, init's index reset) and every push holds `.hyper/space.git/hyper.lock` (`services/space-lock.ts`, O_EXCL, pid/host/start plus the process start id (`/proc` ticks, else `ps -o lstart` under a fixed `TZ=UTC0` stored as epoch seconds: never compare zone-dependent text) and Linux pid namespace; taken over only when the owner is provably gone: same host and namespace, and the pid is dead or has a different start id. A lock file that cannot be read or parsed is never taken over. The 30-min age rule applies only where liveness cannot be judged: other host or pid namespace, no recorded start id, unreadable start; waits 15 s interactively). Every drive command keeps only absolute PATH entries (`BaseCommand.init()`, `lib/safe-path.ts`); other `hyper` topics do not. Never touch the space index outside `withSpaceLock`. Space `push`/`fetch`/`ls-remote` get an ssh `ConnectTimeout` always and `BatchMode` off a terminal (`spaceRemoteEnv`); the ssh program name stays in `services/remote.ts`. CLI-spawning tests set `HYPER_SKIP_NEW_VERSION_CHECK=1`: otherwise oclif's update check leaves a detached writer in the fixture HOME.

Pi gets the same save from `packages/drive/pi`, an extension pi loads itself (never bundled into `~/.pi/agent` by us; `pi install <dir>`, which loads it from the path without copying). It hooks `session_shutdown`, which pi awaits with no timeout, and saves ONLY on reason `quit`: `reload`, `new`, `resume` and `fork` are session replacement, exactly like Claude's `/clear` and resume. The extension decides nothing about spaces itself — it resolves `hyper` from absolute PATH entries only (the candidate must be an executable regular file, and the absolute path is what is spawned, because `bin/` is synced space content), runs `hyper space detect --json` once in the session's directory with a 5 s bound, and uses that answer for root, `spaceGitDir` and `cadence` (two additive `--json` fields `space detect` grew for this). A CLI that answers with an object carrying a root and NO `spaceGitDir` key is from before T-18: it prints the extension's OWN one outdated line (its text, not the hook's) and saves nothing. Everything else is silent — no root, `spaceGitDir: null` (an uninitialised space), a git dir that is not `join(root, ".hyper", "space.git")`, a probe that fails, prints garbage, is flooded past 64 KiB, or overruns the 5 s bound (SIGKILL). An overrun is silent but not traceless: when the walk up from the session's directory finds a REAL space git dir (`.hyper` and `space.git` real directories by `lstat`, no symlink at either level, `HEAD` and `config` regular files; anything else is skipped and the walk continues), the extension appends one `failed` "probe timed out" record to its `session-end.log` in the worker's exact format (replicated, since the extension imports nothing from the CLI; the test parses it with the real reader), so `space status` shows it; it opens the log `O_NOFOLLOW` and leaves a non-regular one alone. With no real space git dir above, it writes nothing; a `manual` space gets the line too (the cadence was never read). The missing-CLI line is printed only when that same ancestor walk finds a space git dir; the walk picks a log directory and a line, never anything to run. The probe and the worker both get a PATH rebuilt from ABSOLUTE entries only, because the CLI's own `bash` and `git` lookups resolve relative entries against the session's directory. It writes `.hyper/space.git/session-end-payload.*` and spawns the same detached worker (`detached: true`, `stdio: "ignore"`, cwd = the session's directory, never a guessed root). Its payload is `session_id`, `cwd`, `harness: "pi"` and `summary` — never `transcript_path`, because a pi session file has no `"type":"summary"` records; the CLI reads `summary` and `harness` as optional untrusted fields, cleans and caps the summary exactly as it does a transcript summary, and only the exact `harness: "pi"` changes the message trailer from `Claude-Session:` to `Pi-Session:` (a Claude payload stays byte-identical). The summary is the session name, else the first line of the first prompt, so prompt text reaches the space's history. It never throws into pi, prints at most one line, and goes through the `hyper` CLI only.

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

- `hyper-kits/nextjs/` and `hyper-kits/skills/` are **git submodules** — the
  only submodules in the repo (see `.gitmodules`).
  gen's e2e tests (`packages/gen/tests/e2e/`) resolve templates from the
  nextjs kit, so
  they need it initialised: `git submodule update --init hyper-kits/nextjs`.
- The packages under `packages/` are NOT submodules — regular monorepo directories
- Tests live in each package's `tests/` directory
- TypeScript strict mode is disabled (to be re-enabled incrementally)
- DTS generation is disabled (inflection types issue — to be fixed)
- **Do not verify with `moon run`** — on this setup it triggers a `bun install`
  that rewrites the root `package.json` (drops `packageManager`, adds
  `engines.node`). Use package-local `bun run <script>` instead.
- **A stale `tsbuildinfo` can make a build silently skip.** When a package
  builds green but `dist/` did not change, delete the package's
  `*.tsbuildinfo` (or force the build) before trusting the output.

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
