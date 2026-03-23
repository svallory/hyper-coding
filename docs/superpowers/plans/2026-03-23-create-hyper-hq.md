# `create-hyper-hq` + `hyper hq setup` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished first-run wizard (`npm create hyper-hq`) that guides users from zero to a running HQ session, plus a `hyper hq setup` command for existing hyper users.

**Architecture:** `create-hyper-hq` is a self-contained Node.js package with no `@hypercli/*` deps. It uses `@clack/prompts` for interactive UI and `node:child_process` for running install commands. `hyper hq setup` is a thin oclif command in `@hypercli/hq` that adds dependency checks before running the existing config wizard. Both share the same UX design but are independent implementations.

**Tech Stack:** TypeScript, `@clack/prompts`, `picocolors`, `node:child_process`, `node:os`, `node:fs`

**Spec:** `docs/superpowers/specs/2026-03-23-create-hyper-hq-design.md`

---

## File Structure

### New files (create-hyper-hq package)

| File | Responsibility |
|------|---------------|
| `packages/create-hyper-hq/package.json` | Package config with bin entry |
| `packages/create-hyper-hq/tsconfig.json` | TypeScript config |
| `packages/create-hyper-hq/src/index.ts` | Entry point: shebang, banner, orchestrator |
| `packages/create-hyper-hq/src/checks/detect-os.ts` | Detect platform, Linux distro, available system PMs |
| `packages/create-hyper-hq/src/checks/detect-pm.ts` | Detect calling PM and available node PMs |
| `packages/create-hyper-hq/src/checks/check-tool.ts` | Check if a tool is on PATH (login shell aware) |
| `packages/create-hyper-hq/src/checks/check-claude-auth.ts` | Check claude auth status |
| `packages/create-hyper-hq/src/install/install-options.ts` | Catalog of install methods per tool per OS |
| `packages/create-hyper-hq/src/install/run-install.ts` | Execute an install command via child_process |
| `packages/create-hyper-hq/src/setup/hq-config-wizard.ts` | Config wizard (projects root, HQ dir, telegram) |
| `packages/create-hyper-hq/src/setup/workspace-trust.ts` | Trust workspace dirs in ~/.claude/projects/ |
| `packages/create-hyper-hq/src/setup/claude-md.ts` | Generate CLAUDE.md for HQ session |
| `packages/create-hyper-hq/src/ui/prompts.ts` | install-or-wait loop, confirm-or-cancel helpers |

### New files (hyper hq setup command)

| File | Responsibility |
|------|---------------|
| `packages/hq/src/commands/hq/setup.ts` | oclif command: dep checks + force-run config wizard |

### Modified files

| File | Change |
|------|--------|
| `packages/hq/src/config/setup.ts` | Add `force` parameter to skip early-exit guard |
| `release-please-config.json` | Add create-hyper-hq package |
| `.release-please-manifest.json` | Add create-hyper-hq version |
| `scripts/bump-versions.mjs` | Add create-hyper-hq to packages array |
| `scripts/release.sh` | Add create-hyper-hq to PACKAGES array |
| `packages/hq/help/hq.md` | Add setup command to help |

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/create-hyper-hq/package.json`
- Create: `packages/create-hyper-hq/tsconfig.json`
- Create: `packages/create-hyper-hq/README.md`
- Create: `packages/create-hyper-hq/LICENSE`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "create-hyper-hq",
  "version": "0.1.1",
  "type": "module",
  "description": "Set up Hyper HQ — always-on Claude Code command center",
  "author": "Saulo Vallory <saulo@toki.life>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/svallory/hyper-coding.git",
    "directory": "packages/create-hyper-hq"
  },
  "homepage": "https://hyperdev.saulo.engineer",
  "bugs": {
    "url": "https://github.com/svallory/hyper-coding/issues"
  },
  "engines": {
    "node": ">=18"
  },
  "bin": {
    "create-hyper-hq": "./dist/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "build": "tsc",
    "postbuild": "echo '#!/usr/bin/env node' | cat - dist/index.js > dist/index.tmp && mv dist/index.tmp dist/index.js",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@clack/prompts": "^1.1.0",
    "picocolors": "^1.1.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.options.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": true,
    "strict": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Copy LICENSE from packages/cli/LICENSE**

- [ ] **Step 4: Create README.md**

```markdown
# create-hyper-hq

Set up [Hyper HQ](https://hyperdev.saulo.engineer) — an always-on Claude Code command center.

## Usage

```sh
npm create hyper-hq
# or
bun create hyper-hq
# or
pnpm create hyper-hq
```

The wizard will guide you through installing dependencies and configuring HQ.

## What it does

1. Checks for and helps install: `hyper` CLI, `claude` CLI, `tmux`
2. Configures HQ (projects directory, session settings)
3. Trusts the workspace for Claude Code
4. Optionally starts HQ immediately

## License

MIT
```

- [ ] **Step 5: Install dependencies**

```bash
cd /work/hyper && bun install
```

- [ ] **Step 6: Commit**

```bash
git add packages/create-hyper-hq/
git commit -m "feat(create-hyper-hq): scaffold package"
```

---

## Task 2: OS and package manager detection

**Files:**
- Create: `packages/create-hyper-hq/src/checks/detect-os.ts`
- Create: `packages/create-hyper-hq/src/checks/detect-pm.ts`
- Create: `packages/create-hyper-hq/src/checks/check-tool.ts`

- [ ] **Step 1: Create detect-os.ts**

Exports:
- `detectPlatform()` → `{ os: "macos" | "linux" | "windows", distroId: string | null, isRoot: boolean }`
- `detectSystemPms()` → `string[]` (available system package managers: brew, apt, dnf, pacman, apk, zypper, port, conda)

Uses `process.platform`, reads `/etc/os-release` on Linux, checks `process.getuid?.() === 0` for root.

- [ ] **Step 2: Create detect-pm.ts**

Exports:
- `detectCallingPm()` → `"npm" | "bun" | "pnpm" | "yarn"` (from `npm_config_user_agent`)
- `detectAvailableNodePms()` → `string[]` (which of npm/bun/pnpm/yarn are on PATH)

- [ ] **Step 3: Create check-tool.ts**

Exports:
- `isToolInstalled(name: string)` → `boolean` — uses login shell (`$SHELL -l -c "which <name>"`) for accurate post-install detection
- `getToolVersion(name: string)` → `string | null` — runs `<name> --version`

- [ ] **Step 4: Build and verify**

```bash
cd /work/hyper/packages/create-hyper-hq && bun run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/create-hyper-hq/src/checks/
git commit -m "feat(create-hyper-hq): add OS, PM, and tool detection"
```

---

## Task 3: Install option catalog and runner

**Files:**
- Create: `packages/create-hyper-hq/src/install/install-options.ts`
- Create: `packages/create-hyper-hq/src/install/run-install.ts`

- [ ] **Step 1: Create install-options.ts**

Exports a function `getInstallOptions(tool, context)` that returns an array of `{ label: string, command: string, args: string[], sudo: boolean }` based on the tool name and detected OS/PMs.

Three tool catalogs:
- `hyper`: node PM global installs, calling PM first
- `claude`: native installer (recommended), brew cask, npm (deprecated)
- `tmux`: OS-specific system PM commands, sudo stripped when root

Each option has a `label` (shown to user) and `command`/`args` (executed).

- [ ] **Step 2: Create run-install.ts**

Exports `runInstallCommand(option)` → `{ success: boolean, error?: string }`.

Uses `child_process.spawn` with inherited stdio so the user sees install output in real-time. Catches errors and returns them as strings.

For sudo commands: spawns `sudo` as the command with the rest as args.

- [ ] **Step 3: Build and verify**

```bash
cd /work/hyper/packages/create-hyper-hq && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/create-hyper-hq/src/install/
git commit -m "feat(create-hyper-hq): add install option catalog and runner"
```

---

## Task 4: UI prompt helpers

**Files:**
- Create: `packages/create-hyper-hq/src/ui/prompts.ts`
- Create: `packages/create-hyper-hq/src/checks/check-claude-auth.ts`

- [ ] **Step 1: Create prompts.ts**

Exports:
- `installOrWaitLoop(toolName, toolUrl, options, checkFn)` — the core install-or-wait UX loop:
  1. Show install options + "I'll install it myself and let you know" + "Cancel"
  2. If auto-install selected: run it, re-check, continue if found
  3. If "I'll install myself": show link, then loop `[Continue] [Cancel]` with re-check
  4. If Cancel: exit gracefully
  5. If tool still not found after Continue: show "Hmm, I still can't find..." and re-offer

- `confirmOrCancel(message)` — simple confirm with cancel handling

Uses `@clack/prompts` (select, note, cancel, isCancel) and `picocolors`.

- [ ] **Step 2: Create check-claude-auth.ts**

Exports:
- `isClaudeAuthenticated()` → `boolean` — runs `claude auth status`, returns true if exit code 0
- `runClaudeLogin()` → `boolean` — runs `claude auth login` with inherited stdio, returns success

- [ ] **Step 3: Build and verify**

```bash
cd /work/hyper/packages/create-hyper-hq && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/create-hyper-hq/src/ui/ packages/create-hyper-hq/src/checks/check-claude-auth.ts
git commit -m "feat(create-hyper-hq): add prompt helpers and claude auth check"
```

---

## Task 5: HQ config wizard and workspace trust

**Files:**
- Create: `packages/create-hyper-hq/src/setup/hq-config-wizard.ts`
- Create: `packages/create-hyper-hq/src/setup/workspace-trust.ts`
- Create: `packages/create-hyper-hq/src/setup/claude-md.ts`

- [ ] **Step 1: Create workspace-trust.ts**

Exports:
- `trustWorkspace(absolutePath: string)` — encodes path (replace `/` with `-`), creates dir under `~/.claude/projects/`
- `isWorkspaceTrusted(absolutePath: string)` → `boolean`

```typescript
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const CLAUDE_PROJECTS_DIR = resolve(homedir(), ".claude", "projects");

function encodePath(dir: string): string {
  return dir.replace(/\//g, "-");
}

export function trustWorkspace(dir: string): void {
  mkdirSync(resolve(CLAUDE_PROJECTS_DIR, encodePath(dir)), { recursive: true });
}

export function isWorkspaceTrusted(dir: string): boolean {
  return existsSync(resolve(CLAUDE_PROJECTS_DIR, encodePath(dir)));
}
```

- [ ] **Step 2: Create hq-config-wizard.ts**

Exports `runConfigWizard()` → `{ projectsRoot: string, hqDir: string, telegramToken?: string }`.

Uses `@clack/prompts` (text, confirm). Prompts for:
1. `projects_root` (default `~/work`) — expand `~` to `homedir()`, create if needed
2. `hq.dir` (default `./hyper-hq`) — resolve relative to projects_root, create if needed
3. Telegram enable? → if yes, prompt for bot token

Writes TOML to `~/.config/hyper/hq.toml` with mode `0o600`. All paths stored as expanded absolute paths.

- [ ] **Step 3: Create claude-md.ts**

Exports `generateHqClaudeMd(projectsRoot: string)` → `string`.

Copy the `generateHqClaudeMd` function from `packages/hq/src/commands/hq/start.ts` (lines 146-203). This is a pure function that returns a markdown string — no deps needed.

- [ ] **Step 4: Build and verify**

```bash
cd /work/hyper/packages/create-hyper-hq && bun run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/create-hyper-hq/src/setup/
git commit -m "feat(create-hyper-hq): add config wizard, workspace trust, and CLAUDE.md generation"
```

---

## Task 6: Main entry point (orchestrator)

**Files:**
- Create: `packages/create-hyper-hq/src/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
#!/usr/bin/env node
```

The orchestrator:
1. Print welcome banner (using `@clack/prompts` intro)
2. Detect OS and package managers
3. Check hyper CLI → `installOrWaitLoop("hyper", "https://hyperdev.saulo.engineer/cli/install", options, () => isToolInstalled("hyper"))`
4. Check claude CLI → `installOrWaitLoop("claude", "https://claude.ai/code", options, () => isToolInstalled("claude"))`
5. Check tmux → if `os === "windows"`, show WSL message with "I'm in WSL, continue" / "Cancel" options. If user says they're in WSL, re-detect OS from `/etc/os-release` and proceed. Otherwise: `installOrWaitLoop("tmux", "https://github.com/tmux/tmux", options, () => isToolInstalled("tmux"))`
6. Check claude auth → if not authenticated, run `claude auth login`
7. Run config wizard → get projectsRoot, hqDir, telegramToken
8. Trust workspaces (projectsRoot + hqDir)
9. Write config + generate CLAUDE.md
10. Ask "Start HQ now?" → if yes, spawn `hyper hq start` with inherited stdio
11. Print outro

Handle `isCancel` from any prompt → print "Setup cancelled." and exit 0.

- [ ] **Step 2: Build and test manually**

```bash
cd /work/hyper/packages/create-hyper-hq && bun run build
node dist/index.js
```

Verify the full flow works interactively.

- [ ] **Step 3: Commit**

```bash
git add packages/create-hyper-hq/src/index.ts
git commit -m "feat(create-hyper-hq): add main entry point orchestrator"
```

---

## Task 7: `hyper hq setup` command

**Files:**
- Create: `packages/hq/src/commands/hq/setup.ts`
- Modify: `packages/hq/src/config/setup.ts`
- Create: `packages/hq/help/hq/setup.md`

- [ ] **Step 1: Add force parameter to runSetupIfNeeded**

In `packages/hq/src/config/setup.ts`, rename to `runSetup(force = false)` and export both. Also remove the `p.outro("Setup complete! Starting HQ...")` from inside `runSetup` — callers handle their own outro messages.

```typescript
export async function runSetup(force = false): Promise<HqConfig> {
  if (!force && configExists()) {
    return loadConfig();
  }
  // ... existing wizard logic, but remove the p.outro() at the end ...
  return loadConfig();
}

// Backwards compat — start.ts calls this
export const runSetupIfNeeded = () => runSetup(false);
```

Update `start.ts` to print its own outro after calling `runSetupIfNeeded()` if it was the first setup.

- [ ] **Step 2: Create setup.ts command**

```typescript
// packages/hq/src/commands/hq/setup.ts
import { Command } from "@oclif/core";
import { spawnSync } from "node:child_process";
import { runSetup } from "../../config/setup.js";

export default class Setup extends Command {
  static override description = "Set up HQ — check dependencies and configure";
  static override examples = ["<%= config.bin %> <%= command.id %>"];

  async run(): Promise<void> {
    // Check tmux
    const tmux = spawnSync("which", ["tmux"], { encoding: "utf-8" });
    if (tmux.status !== 0) {
      this.warn("tmux is not installed. HQ requires tmux to manage sessions.");
      this.log("Install: https://github.com/tmux/tmux/wiki/Installing");
    }

    // Check claude
    const claude = spawnSync("which", ["claude"], { encoding: "utf-8" });
    if (claude.status !== 0) {
      this.warn("Claude CLI is not installed. HQ requires claude to run sessions.");
      this.log("Install: https://claude.ai/code");
    }

    // Check claude auth
    if (claude.status === 0) {
      const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf-8" });
      if (auth.status !== 0) {
        this.log("Claude is not authenticated. Running 'claude auth login'...");
        spawnSync("claude", ["auth", "login"], { stdio: "inherit" });
      }
    }

    // Run config wizard (force mode)
    await runSetup(true);

    // Offer to start HQ
    const { confirm } = await import("@clack/prompts");
    const startNow = await confirm({ message: "Start HQ now?" });
    if (startNow === true) {
      spawnSync("hyper", ["hq", "start"], { stdio: "inherit" });
    } else {
      this.log("\nRun 'hyper hq start' whenever you're ready.");
    }
  }
}
```

- [ ] **Step 3: Create help/hq/setup.md**

```markdown
# hyper hq setup

Check dependencies and configure HQ. Verifies that tmux, Claude CLI, and authentication are in place, then runs the configuration wizard.

## Usage

`hyper hq setup`

## What It Checks

- tmux is installed
- Claude CLI is installed
- Claude authentication is configured
- HQ configuration exists (creates or reconfigures)

## Examples

```sh
# Run the full setup
hyper hq setup
```
```

- [ ] **Step 4: Update packages/hq/help/hq.md to include setup**

Add `hyper hq setup` to the commands table in the topic help file.

- [ ] **Step 5: Build and test**

```bash
cd /work/hyper/packages/hq && bun run build
cd /work/hyper/packages/cli && bun run bin/dev.js hq setup --help
```

- [ ] **Step 6: Commit**

```bash
git add packages/hq/src/commands/hq/setup.ts packages/hq/src/config/setup.ts packages/hq/help/hq/setup.md packages/hq/help/hq.md
git commit -m "feat(hq): add 'hyper hq setup' command with dependency checks"
```

---

## Task 8: Release pipeline integration

**Files:**
- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`
- Modify: `scripts/bump-versions.mjs`
- Modify: `scripts/release.sh`

- [ ] **Step 1: Add to release-please-config.json**

Add to `packages` object:

```json
"packages/create-hyper-hq": {
  "package-name": "create-hyper-hq",
  "component": "create-hyper-hq"
}
```

Add `"create-hyper-hq"` to the `linked-versions.components` array.

- [ ] **Step 2: Add to .release-please-manifest.json**

```json
"packages/create-hyper-hq": "0.1.1"
```

- [ ] **Step 3: Add to bump-versions.mjs**

Add `"create-hyper-hq"` to the `packages` array.

- [ ] **Step 4: Add to release.sh**

Add `create-hyper-hq` to the `PACKAGES` array. Place it before `cli` (no workspace deps, but should publish before cli for ordering consistency).

- [ ] **Step 5: Verify build**

```bash
cd /work/hyper && bun run --filter 'create-hyper-hq' build
```

- [ ] **Step 6: Commit**

```bash
git add release-please-config.json .release-please-manifest.json scripts/bump-versions.mjs scripts/release.sh
git commit -m "chore: add create-hyper-hq to release pipeline"
```

---

## Task 9: End-to-end manual test

- [ ] **Step 1: Build everything**

```bash
cd /work/hyper && bun run --filter '@hypercli/*' build && bun run --filter 'create-hyper-hq' build
```

- [ ] **Step 2: Test create-hyper-hq locally**

```bash
node packages/create-hyper-hq/dist/index.js
```

Walk through the full wizard. Verify:
- Welcome banner shows
- Tool detection works (hyper, claude, tmux should all be found since they're installed)
- Config wizard prompts for projects root and HQ dir
- Config file is written to ~/.config/hyper/hq.toml
- CLAUDE.md is generated
- "Start HQ now?" prompt works

- [ ] **Step 3: Test hyper hq setup**

```bash
cd /work/hyper/packages/cli && bun run bin/dev.js hq setup
```

Verify:
- Dependency checks run and report status
- Config wizard runs (force mode — even if config exists)
- Help renders: `bun run bin/dev.js hq setup --help`

- [ ] **Step 4: Test npm create simulation**

```bash
cd /tmp && npx /work/hyper/packages/create-hyper-hq
```

Verify the package works when invoked via npx (simulates `npm create hyper-hq`).

- [ ] **Step 5: Run existing tests**

```bash
cd /work/hyper/packages/cli && bun test
cd /work/hyper/packages/hq && bun test
```

Ensure nothing is broken.

- [ ] **Step 6: Final commit if any fixes needed**

---

## Verification

After all tasks:

```bash
# Full build
cd /work/hyper && bun run --filter '@hypercli/*' build && bun run --filter 'create-hyper-hq' build

# CLI tests
cd /work/hyper/packages/cli && bun test

# Manual test create-hyper-hq
node packages/create-hyper-hq/dist/index.js

# Manual test hyper hq setup
cd packages/cli && bun run bin/dev.js hq setup

# Help renders correctly
bun run bin/dev.js hq setup --help
bun run bin/dev.js hq --help  # should now include setup in commands table
```
