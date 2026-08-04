---
name: hyper-tooling
description: Use when setting up linters, formatters, typecheckers, or automated check hooks for a project — detecting which tools a project already uses rather than assuming defaults. Covers Node/Bun/TypeScript, Go, Python, and Rust. Triggers on "set up linting", "add a check hook", "run typecheck on edit", "what tools does this project use", "hyper tools".
---

# Project Tooling Integration

Gives an agent the same external safeguards a human developer gets from their
editor: a linter and typechecker that run automatically and fail loudly. This
is Hyper's *Tools Integration* and *Real-time Feedback* principles.

## The one rule

**Detect the project's actual commands. Never assume defaults.**

A wrong command is worse than no command. `npm run lint` in a project with no
`lint` script fails on every edit; within a day everyone ignores the hook, and
the real failures go unnoticed too.

Evidence, strongest first:

1. A script in `package.json` / a `Makefile` target — encodes flags, config
   paths, and monorepo wiring the raw binary does not.
2. A config file (`biome.json`, `.eslintrc*`, `tsconfig.json`, `.golangci.yml`)
   — proves the tool is configured, but not that a script exists to run it.
3. Nothing — **ask the user**. Do not fall back to a convention.

## Detecting

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-stack.sh" detect [dir]
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-stack.sh" list
```

Prints `KEY=VALUE` facts, omitting any key it cannot verify. A missing
`LINT` means the project has no lint script — an answer, not a gap to fill
with a guess.

## Node / Bun / TypeScript

Package manager, by decreasing evidence strength: `packageManager` field →
lockfile (`bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`) →
unknown. **Report unknown rather than defaulting to npm**; running `npm install`
in a bun project rewrites the lockfile.

Script names vary. Detection tries the common variants:

| Purpose | Names tried |
|---|---|
| lint | `lint`, `lint:all`, `check` |
| format | `format`, `fmt`, `prettier` |
| typecheck | `typecheck`, `type-check`, `types`, `tsc` |
| test | `test` |

Real shapes this must handle:

- Scripts delegating to a task runner (`"lint": "moon run :lint"`) — invoke the
  script, not `moon` directly.
- A `tsconfig.json` and eslint config but *no* lint or typecheck script — the
  tools exist, the entry points do not. Ask before inventing one.
- Monorepos where the root has no checks and packages do. Detect per-package.

Typecheck usually catches more real breakage than lint; lint is usually faster.
On a large codebase a full typecheck per edit is too slow — prefer a scoped
command or lint, and set a `timeout`.

## Go

The toolchain is fixed by convention, so `gofmt`, `go vet ./...`,
`go build ./...`, and `go test ./...` are safe to assert without inspection.

`golangci-lint` is *not* part of the toolchain. Only use it when both
`.golangci.yml` and the binary are present — detection reports `LINT_MISSING`
when configured but not installed. Prefer a `Makefile` target when one exists.

## Python

Nothing is fixed by convention: package manager, linter, type checker, and
test runner are all independent choices, so everything is inferred from files
actually present. `PM` comes from the lockfile (`uv.lock` → uv, `poetry.lock`
→ poetry, `Pipfile.lock` → pipenv; a bare `requirements.txt` → pip); `PM_RUN`
exists only for managers with a runner — pip and unknown have none.

Tool keys are two-stage: config presence (`ruff.toml`, `[tool.ruff]`,
`mypy.ini`, `pytest.ini`, …) asserts `LINT_TOOL`/`TYPECHECK_TOOL`/`TEST_TOOL`,
but the runnable `LINT`/`TYPECHECK`/`TEST` (e.g. `uv run ruff check`) is
emitted only when a `PM_RUN` exists *and* the tool is a visibly declared
dependency — a configured-but-uninstalled tool would fail on every edit. A
`*_TOOL` key without its command means: ask how to run it, do not guess.
Detected values are full commands — wire them with `command`, not `run`.

## Rust

cargo fixes most of the toolchain: `cargo fmt`, `cargo check`, and
`cargo test` ship with every installation and are asserted without inspection
(as full commands — use `command`). Clippy is the moving part: a rustup
component that may be absent. Detection checks for `clippy-driver` (or
rustup's component list) and only then emits `LINT=cargo clippy`; a
`clippy.toml` with no installed component reports `LINT_MISSING` instead.

## Enabling the check hook

Write `<project>/.claude/hyper.json`:

```json
{ "check": { "enabled": true, "run": "typecheck", "extensions": [".ts"], "timeout": 60 } }
```

`run` is a script name (invoked with the detected package runner); `command` is
an explicit command and overrides it — use `command` for Go and Makefile
targets. The hook does nothing until `enabled` is true.

**Verify before enabling.** Run the command by hand on a clean tree and confirm
it exits 0. If it fails on unmodified code, fix it or leave the hook off.

## Adding a stack

Create `stacks/<name>/detect.sh` defining:

- `stack_matches <dir>` — exit 0 when the stack applies (a marker file:
  `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`).
- `stack_detect <dir>` — print `KEY=VALUE` facts, omitting unverifiable keys.

Stacks are discovered by directory scan, so no registry edit is needed. Keep
the same honesty contract: report only what is verifiable, and let absence mean
unknown.
