# `create-hyper-hq` + `hyper hq setup` Design Spec

## Goal

Provide a polished first-run experience for Hyper HQ that guides users from zero to a running HQ session. Two entry points, one shared design:

1. **`npm create hyper-hq`** — standalone package for users who don't have hyper yet
2. **`hyper hq setup`** — command for users who already have hyper installed

## Package: `create-hyper-hq`

- **Location**: `packages/create-hyper-hq/`
- **npm name**: `create-hyper-hq` (no scope — enables `npm create hyper-hq`)
- **Version**: synced with all `@hypercli/*` packages via release-please
- **Runtime**: Node.js (must work without bun since `npm create` uses node)
- **Entry point**: `dist/index.js` — **must include `#!/usr/bin/env node` shebang** (required for `npm create` / `npx` execution)

## Architecture

```
packages/create-hyper-hq/
├── src/
│   ├── index.ts          # bin entry — shebang + banner + orchestrator
│   ├── checks/
│   │   ├── detect-os.ts      # OS, distro, shell detection
│   │   ├── detect-pm.ts      # detect calling PM + available PMs
│   │   ├── check-tool.ts     # generic "is <tool> on PATH?" check
│   │   └── check-claude-auth.ts  # claude auth status
│   ├── install/
│   │   ├── install-options.ts    # catalog of install methods per tool
│   │   └── run-install.ts        # execute an install option via child_process
│   ├── setup/
│   │   ├── hq-config-wizard.ts   # self-contained config wizard
│   │   └── workspace-trust.ts    # workspace trust logic (see encoding details below)
│   └── ui/
│       └── prompts.ts        # shared prompt helpers (install-or-wait loop, etc.)
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE

packages/hq/src/commands/hq/
└── setup.ts                  # thin wrapper: dep checks + runSetup(force=true)
```

### Self-contained design

`create-hyper-hq` cannot depend on `@hypercli/hq` — users don't have hyper installed yet. The package inlines its own config wizard and trust logic. This is acceptable because:
- The config wizard is simple (5 prompts + file write)
- The trust logic is trivial (~10 lines, see encoding details below)
- The dependency checks are unique to the create package

### No execa dependency

Use `node:child_process` (`execFileSync`, `spawnSync`, `spawn`) exclusively. This keeps the package lightweight and avoids issues with transitive deps. The operations are simple (run a command, check exit code, capture output).

## Workspace Trust Encoding

Claude Code encodes trusted workspace paths as directory names under `~/.claude/projects/`. The encoding replaces every `/` with `-`:

```typescript
// /Users/foo/work → -Users-foo-work
const encoded = absolutePath.replace(/\//g, "-");
const trustDir = path.join(os.homedir(), ".claude", "projects", encoded);
fs.mkdirSync(trustDir, { recursive: true });
```

**Critical**: The leading slash produces a leading `-`. For example:
- `/Users/svallory/work` → `-Users-svallory-work`
- `/home/user/projects` → `-home-user-projects`

Both `create-hyper-hq` and `hyper hq setup` must use this exact encoding.

## Tool Check: Login Shell for Post-Install Detection

After installing a tool, the current process's `PATH` may not include the new binary's location. To detect a freshly installed tool:

```typescript
// Use a login shell to pick up PATH changes from .bashrc/.zshrc
const shell = process.env.SHELL || "/bin/bash";
const result = spawnSync(shell, ["-l", "-c", `which ${toolName}`], {
  encoding: "utf-8",
  timeout: 5000,
});
const found = result.status === 0;
```

This ensures brew/npm global installs are detected even if the wizard's own PATH doesn't include them yet.

## Claude Auth Check

Check authentication status using `claude auth status`:

```typescript
const result = spawnSync("claude", ["auth", "status"], {
  encoding: "utf-8",
  timeout: 10000,
});
// Exit code 0 = authenticated, nonzero = not authenticated
const isAuthenticated = result.status === 0;
```

If not authenticated, run `claude auth login` interactively (inheriting stdio so the user can complete the OAuth flow in their browser).

## `hyper hq setup` Command

New command in `packages/hq/src/commands/hq/setup.ts` that:

1. Checks tmux, claude, claude auth (same checks as create-hyper-hq, minus the @hypercli/cli check)
2. Calls a new `runSetup()` function (not `runSetupIfNeeded()`) — always runs the wizard regardless of existing config, allowing reconfiguration
3. Offers to start HQ

The existing `runSetupIfNeeded()` in `packages/hq/src/config/setup.ts` gets a sibling: `runSetup(force?: boolean)` that skips the early-exit guard when `force=true`. `runSetupIfNeeded()` becomes `runSetup(false)`.

## User Flow

### Step 0: Welcome

```
┌  create-hyper-hq
│
◆  Welcome to Hyper HQ Setup!
│
│  HQ is an always-on Claude Code command center that runs in a
│  tmux session. Once started, you can control it from claude.ai,
│  the Claude mobile app, or Telegram.
│
│  Let's make sure you have everything you need.
│
└
```

### Step 1: Check @hypercli/cli

```
◆  Checking for hyper CLI... not found

│  The hyper CLI is the main command-line tool for HyperDev.
│  https://hyperdev.saulo.engineer
│
◆  How would you like to install it?
│  ● npm install -g @hypercli/cli
│  ○ bun install -g @hypercli/cli
│  ○ I'll install it myself and let you know
│  ○ Cancel
```

Options shown depend on detected package managers. The PM that ran `create-hyper-hq` is listed first (detected via `npm_config_user_agent` env var).

**"I'll install it myself and let you know" flow:**

```
◆  Take your time! Here are some resources:
│  https://hyperdev.saulo.engineer/cli/install
│
◆  Ready to continue?
│  ● Continue
│  ○ Cancel
```

On "Continue", re-check (using login shell). If still not found:

```
◇  Hmm, I still can't find `hyper` on your PATH.
│  Installation guide: https://hyperdev.saulo.engineer/cli/install
│
◆  Ready to continue?
│  ● Continue
│  ○ Cancel
```

Loop until found or cancelled.

### Step 2: Check Claude CLI

```
◆  Checking for Claude CLI... not found

│  Claude Code is the AI coding assistant that powers HQ sessions.
│  https://claude.ai/code
│
◆  How would you like to install it?
│  ● curl -fsSL https://claude.ai/install.sh | bash  (recommended, auto-updates)
│  ○ brew install --cask claude-code
│  ○ npm install -g @anthropic-ai/claude-code  (deprecated)
│  ○ I'll install it myself and let you know
│  ○ Cancel
```

Options depend on OS and available tools. Native installer always first and marked recommended.

### Step 3: Check tmux

```
◆  Checking for tmux... not found

│  tmux is a terminal multiplexer that keeps HQ sessions running
│  in the background, even after you close your terminal.
│  https://github.com/tmux/tmux
│
◆  How would you like to install it?
│  ● brew install tmux
│  ○ I'll install it myself and let you know
│  ○ Cancel
```

Options are OS-specific (see Install Option Catalog below).

**Sudo handling**: If the process is running as root (`process.getuid?.() === 0`), omit `sudo` from commands. This handles Docker containers and root shells.

### Step 4: Check Claude authentication

```
◆  Checking Claude authentication... not authenticated

│  You need to log in to Claude to use HQ.
│
◆  Running `claude auth login`...
```

Runs `claude auth login` with inherited stdio for interactive OAuth.

### Step 5: HQ Configuration

```
◆  Where are your projects?
│  ~/work
│
◆  HQ working directory (relative to projects root)?
│  ./hyper-hq
│
◆  Enable Telegram integration?
│  ○ Yes
│  ● No
```

**Path handling**: All paths are expanded to absolute paths before writing to config. `~/work` is expanded to `/Users/<user>/work` in the TOML file. This prevents ambiguity in downstream consumers.

### Step 6: Workspace Trust + Config Write

```
◆  Trusting workspace directories...
│  ✓ /Users/svallory/work/hyper-hq
│  ✓ /Users/svallory/work
│
◆  Writing config to ~/.config/hyper/hq.toml
│  ✓ Config saved (mode 0600)
│
◆  Generating CLAUDE.md for HQ session
│  ✓ /Users/svallory/work/hyper-hq/CLAUDE.md created
```

### Step 7: Done

```
◆  All set! HQ is ready to go.
│
◆  Start HQ now?
│  ● Yes, start HQ
│  ○ No, I'll start it later
│
│  (You can always run `hyper hq start` to launch HQ)
│
└
```

If "Yes", runs `hyper hq start` with inherited stdio.

## Windows / WSL Handling

`tmux` is not available natively on Windows. When `process.platform === "win32"`:

```
◆  Checking for tmux... not available on Windows

│  tmux requires a Linux environment. HQ works inside WSL
│  (Windows Subsystem for Linux).
│
│  If you're running this from WSL, tmux can be installed with
│  your Linux distro's package manager.
│
│  If you're running this from Windows directly, please install
│  WSL first: https://learn.microsoft.com/windows/wsl/install
│  Then re-run this setup from inside WSL.
│
◆  What would you like to do?
│  ○ I'm in WSL, continue
│  ○ Cancel
```

If the user says "I'm in WSL, continue", re-detect OS from `/etc/os-release` and show appropriate install options.

## OS/PM Detection

### Detecting the calling package manager

```typescript
const userAgent = process.env.npm_config_user_agent ?? "";
const callingPm = userAgent.startsWith("bun") ? "bun"
  : userAgent.startsWith("pnpm") ? "pnpm"
  : userAgent.startsWith("yarn") ? "yarn"
  : "npm";
```

### Detecting available PMs on the system

Check `which <pm>` for: npm, bun, pnpm, yarn, brew, port, conda.

### Detecting OS / Linux distro

```typescript
const platform = process.platform; // "darwin" | "linux" | "win32"

// For Linux: parse /etc/os-release
function getLinuxDistroId(): string | null {
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf-8");
    const match = osRelease.match(/^ID=(.+)$/m);
    return match?.[1]?.replace(/"/g, "") ?? null;
  } catch {
    return null;
  }
}

// Map distro to package manager
function getSystemPm(distroId: string): string {
  const map: Record<string, string> = {
    ubuntu: "apt", debian: "apt", linuxmint: "apt", pop: "apt",
    fedora: "dnf", rhel: "dnf", centos: "dnf", rocky: "dnf", alma: "dnf",
    arch: "pacman", manjaro: "pacman", endeavouros: "pacman",
    alpine: "apk",
    opensuse: "zypper", "opensuse-leap": "zypper", "opensuse-tumbleweed": "zypper", sles: "zypper",
  };
  return map[distroId] ?? "unknown";
}
```

## Install Option Catalog

### @hypercli/cli

| Option | Condition | Sudo |
|--------|-----------|------|
| `<callingPm> install -g @hypercli/cli` | calling PM | No |
| `npm install -g @hypercli/cli` | npm available (if not calling PM) | No |
| `bun install -g @hypercli/cli` | bun available (if not calling PM) | No |
| `pnpm install -g @hypercli/cli` | pnpm available (if not calling PM) | No |

Calling PM shown first. Only show PMs that are available.

### Claude CLI

| Option | Condition | Sudo | Note |
|--------|-----------|------|------|
| `curl -fsSL https://claude.ai/install.sh \| bash` | macOS/Linux | No | Recommended, auto-updates |
| `brew install --cask claude-code` | brew available | No | |
| `npm install -g @anthropic-ai/claude-code` | npm available | No | Deprecated |

Native installer always first as recommended.

### tmux

| Option | Condition | Sudo |
|--------|-----------|------|
| `brew install tmux` | macOS + brew | No |
| `sudo port install tmux` | macOS + MacPorts | Yes |
| `sudo apt install tmux` | Debian/Ubuntu | Yes* |
| `sudo dnf install tmux` | Fedora/RHEL | Yes* |
| `sudo pacman -S tmux` | Arch | Yes* |
| `sudo apk add tmux` | Alpine | Yes* |
| `sudo zypper install tmux` | openSUSE | Yes* |
| `conda install -c conda-forge tmux` | conda available | No |

\* `sudo` omitted when running as root (`process.getuid?.() === 0`).

Only applicable options shown based on detected OS and available tools.

## Package Configuration

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
  "dependencies": {
    "@clack/prompts": "^1.1.0",
    "picocolors": "^1.1.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

Node 18+ (minimum for npm create to work well).

## release-please Integration

Add to `release-please-config.json` packages:

```json
"packages/create-hyper-hq": {
  "package-name": "create-hyper-hq",
  "component": "create-hyper-hq"
}
```

Add `"create-hyper-hq"` to `linked-versions.components` array.

Add to `.release-please-manifest.json`:

```json
"packages/create-hyper-hq": "0.1.1"
```

Add `"create-hyper-hq"` to `scripts/bump-versions.mjs` packages array and `scripts/release.sh` PACKAGES array.

**Note on linked-versions**: `create-hyper-hq` has no `@hypercli/*` workspace dependencies, so the `node-workspace` plugin won't link it. However, `linked-versions` operates independently — it synchronizes versions for all components in its `components` array regardless of workspace dependency links. This is verified in the release-please source: the plugin iterates `components` by name, not by workspace graph.

## Error Handling

- All `child_process` calls wrapped in try-catch
- If a tool install command fails, show the error output and re-offer the install options (don't crash)
- If a tool is not found after install, suggest: "You may need to open a new terminal. The tool should be available after that."
- Ctrl+C at any point exits gracefully with "Setup cancelled."
- If `claude auth login` fails or times out, offer to retry or skip (with warning that HQ won't work without auth)

## What This Does NOT Do

- Does not install Node.js (required to run `npm create` in the first place)
- Does not modify the user's shell config (.bashrc, .zshrc, etc.)
- Does not install or configure tmux plugins
- Does not create Telegram bots (config wizard asks for an existing token)
