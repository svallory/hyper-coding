---
name: tools
description: Detect the project's toolchain and set up the check hook using the tools that project actually uses
argument-hint: "[project-path]"
---

# Tools

Wires Hyper's *Tools Integration* and *Real-time Feedback* principles into a
project: after each edit, the project's own linter or typechecker runs and any
failure goes straight back to the agent.

The commands are **project-dependent**. Detect them; do not assume them.

## Step 1 — detect

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-stack.sh" detect [path]
```

Emits `KEY=VALUE` facts. Keys are omitted when not verifiable:

| Key | Meaning |
|---|---|
| `STACK` | `node`, `go`, `python`, `rust`, or `unknown` (stacks are auto-discovered from `stacks/*/detect.sh`, so new values can appear) |
| `PM` / `PM_RUN` | package manager and its run prefix (`bun run`, `uv run`, `cargo`, …) |
| `LINT` / `FORMAT` / `TYPECHECK` / `TEST` | what to run. Node stacks report the *script name* that exists in the project (wire it via `run`); Go, Rust, and Python report a *full command* (`go build ./...`, `cargo check`, `uv run ruff check`) — wire those via `command`, never `run` |
| `LINT_TOOL` / `TYPECHECK_TOOL` | underlying tool inferred from config files |
| `LINT_MISSING` | configured but not installed |

**A missing key means unknown, not "use the default."** `npm run lint` in a
project with no `lint` script fails every time and teaches everyone to ignore
the hook.

## Step 2 — ask when detection is incomplete

Read the results, then ask the user about anything unresolved:

- **No `TYPECHECK`/`LINT` key but `LINT_TOOL` or `tsconfig.json` present** — the
  tool is configured but has no script. Ask whether to add a script or invoke
  the binary directly.
- **`PM=unknown`** (no lockfile, no `packageManager` field) — ask which package
  manager. Never default to npm.
- **`LINT_MISSING`** — tell the user it is configured but not installed; ask
  whether to install it or skip the hook.
- **Both `LINT` and `TYPECHECK` exist** — ask which to run per-edit. Typecheck
  usually catches more real breakage; lint is usually faster. Running both on
  every edit is normally too slow.
- **`STACK=go`, `rust`, or `python`** — the detected values are full commands;
  wire them with `command`, not `run`. Python only emits a runnable command
  when a runner (`uv`/`poetry`/`pipenv`) exists *and* the tool is a declared
  dependency; with `PM=pip` or `PM=unknown` there is no runner — ask for the
  exact command instead of inventing one.
- **`STACK=unknown`** — ask for the check command outright, or skip.

Prefer the project's own script name over a raw binary. Scripts already encode
flags, config paths, and monorepo wiring (`moon run :lint`, `tsc -p server/...`).

## Step 3 — write the config

Write `<project>/.claude/hyper.json`:

```json
{
  "check": {
    "enabled": true,
    "run": "typecheck",
    "extensions": [".ts", ".tsx"],
    "timeout": 60
  }
}
```

- `run` — a script name, invoked with the detected `PM_RUN`.
- `command` — an explicit command; overrides `run`. Use for Go or non-script
  entry points (`go build ./...`, `make lint`). Quoting inside it is passed to
  the shell untouched, so `sh -c 'a && b'` works as written.
- `extensions` — restrict to files worth checking. Omit to check every edit.
- `timeout` — seconds; the check is killed past this and reported as a timeout.
  The hook uses `timeout` if on its PATH, else `gtimeout` (homebrew coreutils);
  when neither exists — stock macOS with no coreutils, or a hook environment
  without homebrew's PATH — the command runs with **no time limit** rather than
  failing. Do not rely on the timeout existing on macOS.
  **Hard ceiling: Claude Code kills the whole hook at 90 seconds**
  (`hooks/hooks.json`), and that kill is silent — no "timed out" report
  reaches the agent. A configured timeout at or above ~90s, or several checks
  whose timeouts sum past it, never produces the explicit timeout message this
  doc promises. Keep the sum of all timeouts comfortably under 90s.

The hook is inert until `enabled` is true, so a project that has not run this
command is unaffected.

### Multiple checks

When more than one check should fire — lint and typecheck, or per-language
routing — use a `checks` array instead. Each entry takes the same
`run`/`command`/`extensions`/`timeout` keys and only runs when the edited file
matches its own filter:

```json
{
  "checks": [
    { "run": "lint",      "extensions": [".ts", ".tsx"], "timeout": 30 },
    { "run": "typecheck", "extensions": [".ts", ".tsx"], "timeout": 60 }
  ]
}
```

Checks run in order; the first failure is reported and stops the rest, so put
the fastest check first. Writing the array is the opt-in — there is no outer
`enabled` flag — and a single entry can be turned off with `"enabled": false`.
If both `checks` and `check` are present, `checks` wins; a lone `check` object
keeps working unchanged.

## Step 4 — verify before claiming it works

Run the command manually first:

```bash
cd <project> && <the command>
```

Confirm it exits 0 on a clean tree. A check that fails on unmodified code will
fire on every edit and is worse than no check. If it fails, fix the command or
leave the hook disabled — do not enable it and hope.

**Exit 0 alone is not proof the check ran.** With a build cache (turbo, nx,
gradle, bazel) a replayed cache hit is indistinguishable from real work by exit
code. Confirm the check actually executes and actually fails:

```bash
bun run typecheck -- --force      # args after -- reach the underlying tool
bunx turbo run typecheck --force  # or invoke the runner directly
# nx: --skip-nx-cache   gradle: --rerun-tasks   bazel: --nocache_test_results
```

Watch the duration. A "passing" typecheck that finishes in 30ms did not run
`tsc`; a cold run takes seconds. Then prove it detects a real fault — add a
file with a deliberate type error, confirm non-zero exit and the error in the
output, and delete it. A check that cannot fail is worse than none, because it
reports safety that does not exist.

## Step 5 — monorepo coverage

A passing check only vouches for the files it inspected. In a monorepo, a
package with no `typecheck` (or `lint`) script is silently skipped: editing a
file there matches the extension filter, the command runs, and it passes
without ever inspecting the file.

Compare the workspace package list against what the check command actually
covers:

1. List the workspace packages (`workspaces` in `package.json`, `pnpm-workspace.yaml`,
   `turbo.json`/`moon.yml` project lists — whatever the repo uses).
2. For each package, confirm it has the script the check runs (or is reached by
   the runner: `turbo run typecheck --dry-run`, `moon query tasks`, … show
   exactly which packages participate).
3. **Warn the user about every package with no such script**, naming it. Those
   packages get a green check that means nothing. Either add the script, narrow
   `extensions` (or a per-check filter in `checks`) so uncovered files never
   trigger the hook, or record the gap where the team will see it.

Do not skip this step just because the root command exits 0 — that is exactly
the failure mode being checked for.

## Hooks do not inherit your shell

The hook runs the command without your interactive shell's environment. Two
consequences bite in practice:

**Version managers may not resolve.** With proto, mise, asdf, nvm or volta, the
`npm`/`node` on PATH is a shim that needs environment the hook does not have.
A command that works in your terminal can fail under the hook with something
like `proto::detect::failed` or `command not found`. Prefer the project-local
binary, which skips resolution entirely:

```json
{ "check": { "command": "./node_modules/.bin/tsc --build server/tsconfig.json" } }
```

**Relative paths resolve against the directory holding the config**, because the
hook `cd`s there before running. In a bare-layout space, a config at the
space root has no `node_modules` beside it — `./node_modules/.bin/tsc` will
not exist. Put the config in the worktree whose files you are editing, not at
the space root, whenever the command uses a relative path.

Always test the configured command through the hook itself, not just in your
shell:

```bash
echo '{"tool_input":{"file_path":"<abs path to a real source file>"}}' \
  | bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-check.sh"; echo "exit=$?"
```

Exit 0 on a clean file and exit 2 on a file with a deliberate error.

## Recommending new tools

Everything above wires up what the project *already* uses — that stays the
primary purpose of this command. When the user asks what to *add* (or asks for
"recommendations", "security tooling", "a formatter", …), use the curated
catalog instead of improvising:

1. **Ask which aspects to configure** with AskUserQuestion (multi-select).
   The aspect taxonomy: `lint`, `format`, `typecheck`, `test`, `security`,
   `ci`, `complexity`, `deps`, `docs`, `hooks`, `release`. Do not recommend
   anything for aspects the user did not pick.

2. **Run the recommender** with the chosen aspects:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-recommend.sh" <project-dir> [aspect ...]
   ```

   It detects *all* matching stacks (a node+go repo gets both), filters the
   catalog (`resources/recommended-tools.json`), and prints matches grouped by
   aspect. Within a group, tools covering more of the detected stacks print
   first — in a polyglot repo a cross-language tool beats a per-language pair.
   `[configured]` means a known config file exists in the project;
   `[installed]` means the binary is on PATH; an unmarked tool is *unverified*,
   not absent. Report-only; it never installs or writes anything. If it prints
   "node unavailable", read the catalog JSON directly.

3. **Present recommendations per aspect as questions.** Note tools already
   marked `[configured]`/`[installed]` as present rather than re-recommending
   them. Tools whose `notes` field declares a conflict (biome vs
   eslint+prettier, oxlint vs eslint, pyright vs mypy, dprint vs prettier)
   are *alternatives*: never co-recommend them in one question — offer them as
   options to choose between, and surface the note so the user knows why.

4. **Configure only what the user selects.** For each chosen tool, propose the
   install and config steps (from its docs URL) and get confirmation before
   running anything. When a selection covers `lint` or `typecheck`, wire it
   into the check hook config (`.claude/hyper.json`, per Steps 3–4 above)
   so the choice actually feeds back into the edit loop.

5. **Never auto-install.** No package is added, no config written, without an
   explicit per-tool confirmation. Declining a recommendation is a fine
   outcome; record nothing.

## Security

`command` is executed as written, from a file inside the repository. A checkout
you do not trust can therefore run arbitrary code the first time you edit a
file in it.

Read `.claude/hyper.json` before enabling the hook in an unfamiliar repo,
the same way you would read a `Makefile` before running `make`. Prefer `run`
(a script name) over `command` where possible: it still resolves through
`package.json`, but it keeps the moving part in one place the team reviews.

## Notes

- Config lives in the project's `.claude/`, so it is committed and shared with
  the team; the space-level `.claude/` is local-only.
- Legacy name: projects configured before the rename may still have
  `.claude/hyperdev.json`. The hooks keep honoring it as a fallback
  (`hyper.json` wins when both exist), and it is never auto-renamed because it
  may be committed project config — suggest renaming it to `.claude/hyper.json`
  when the team is ready.
- Timeouts matter: a 3-minute typecheck on every edit makes the agent unusable.
  For large projects prefer a fast scoped command, or lint over typecheck.
- The hook has a fixed per-edit cost *before* the `extensions` filter applies:
  it parses the hook payload and the config (two `node` spawns) on every
  Edit/Write in an opted-in project. Tens of milliseconds with a plain `node`
  on PATH — but when `node` resolves through a version-manager shim (proto,
  mise, asdf) each spawn can take ~1s, so every edit pays roughly 2s even
  when `extensions` skips the check. Measured, not hypothetical. If that is
  too slow, point the hook at a shim-free node or disable the hook for that
  project. `extensions` only skips the check command itself, not this
  overhead.
