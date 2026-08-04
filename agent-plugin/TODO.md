# TODO — hyper improvement backlog

Rough priority order within each section. Items marked with a pillar name
close a gap in the [Hyper Coding](https://hyperdev.saulo.engineer) coverage
(see README § Methodology coverage).

## Recommended tools catalog (Tools Integration)

The biggest planned expansion of `/hyper:tools`. Today it only wires up
what a project *already* uses; it should also help choose what to add.

- [x] **Shipped:** `resources/recommended-tools.json` (31 tools) +
      `scripts/hyper-recommend.sh` (multi-stack detection, aspect
      filtering, coverage ranking, presence markers) + the interactive flow
      in `commands/tools.md` ("Recommending new tools") +
      `tests/test-j-recommend.sh`. Details below describe what was built.
- **`resources/recommended-tools.json`** — one machine-parsable catalog, not
  per-stack markdown files, because tools cross stacks and the interesting
  recommendations come from querying across them. Per tool:

  ```json
  {
    "id": "biome",
    "name": "Biome",
    "description": "Fast formatter + linter for JS/TS/JSON/CSS",
    "docs": "https://biomejs.dev",
    "repo": "https://github.com/biomejs/biome",
    "stacks": ["node"],
    "aspects": ["lint", "format"],
    "detect": { "config": ["biome.json", "biome.jsonc"], "bin": "biome" },
    "notes": "replaces eslint+prettier; do not recommend alongside them"
  }
  ```

  Aspect taxonomy (superset of what the methodology names — the hyper coding
  doc is not exhaustive): `lint`, `format`, `typecheck`, `test`, `security`
  (dependency audit, secret scanning, SAST), `ci`, `complexity`, `deps`
  (renovate-style updating), `docs`, `adr`, `hooks` (git hooks), `release`.

- **Multi-stack awareness.** A monorepo with TS + Go should surface tools
  that cover both (e.g. one formatter/linter spanning languages, one CI
  config, trunk-style meta-linters) *before* per-stack pairs. Query:
  aspects wanted ∩ stacks detected, rank tools covering more of the
  intersection higher.
- **Interactive flow** in `/hyper:tools`:
  1. Ask which **aspects** the user wants configured (AskUserQuestion,
     multi-select: linting, formatting, security, CI/CD, …).
  2. Detect stacks (already built) and which catalog tools are already
     present (`detect` field).
  3. Present recommendations per aspect as questions — already-installed
     tools pre-noted, conflicting tools (see `notes`) never co-recommended.
  4. Configure only what the user selects; wire lint/typecheck choices into
     the check hook.
- [ ] Stack detectors gain a generic pass that reports catalog tools found
      via `detect`, so the catalog and detection stay one system. (Not part
      of the shipped work above.)

## Onboarding / UX

- [x] `/hyper:help` command (orientation + standard flow)
- [x] "Next steps" output after init / adopt / audit
- [ ] PostInstall touchpoint: the SessionStart hook is silent outside spaces
      by design, so a fresh install produces zero signal. Investigate a
      one-time "hyper installed — run /hyper:help" nudge that never
      repeats.
- [x] `/hyper:prune` — **shipped as `/hyper:cleanup`** (renamed: git
      owns "prune" for metadata-only deletion, and the collision would
      mislead). List mode + per-id `--delete`, every deletion confirmed per
      item and re-verified at deletion time; no `--all` flag, ever.

## Multi-harness builds

This directory stays the canonical Claude Code-format source; other harnesses
get generated builds.

- [ ] First pass with [acplugin](https://github.com/tokenRollAI/acplugin) to
      produce Codex / OpenCode / Cursor / Pi builds from this source.
- [ ] Cursor: native hooks wiring (map SessionStart / PostToolUse onto
      Cursor's hook surface instead of shelling the Claude hook JSON shape).
- [ ] OpenCode: TypeScript shim around the existing scripts (they are
      tool-agnostic; only the hook wiring is harness-specific).
- [ ] Committed per-harness registries in the style of wshobson/agents, with
      round-trip checks so a generated build failing to reproduce from source
      fails CI.

## Codex / cross-tool support

- [ ] Scaffold `AGENTS.md` at the space root (and optionally worktrees) with
      the layout rules; make `CLAUDE.md` import it (`@AGENTS.md`) so Claude
      and Codex read one source of truth.
- [ ] Reference `.hyper/memory/MEMORY.md` from `AGENTS.md` so Codex
      sessions get space memory too (Codex has no autoMemoryDirectory).
- [ ] Thin Codex config shim reusing `hyper-check.sh` unchanged (the
      scripts are tool-agnostic; only the hook wiring is Claude-specific).

## Check hook (Real-time Feedback)

- [ ] Per-file routing: `eslint <file>` is correct and fast per file;
      `tsc` is not. Route per tool: `"per_file": {"eslint": [".ts"]}`.
- [ ] Monorepo coverage detection in the script (today it is a documented
      manual step in tools.md): compare workspace members against what the
      check command touches, warn on silently-skipped packages.
- [ ] Surface check-hook overhead: measure and report the fixed per-edit
      cost during /hyper:tools setup so the user chooses commands
      knowingly (~2s under version-manager shims).

## Engineered Friction

- [ ] Complexity signal: flag functions/files crossing a size or nesting
      threshold after edit — report-only, like everything else.
- [ ] Extend the deps hook beyond manifests: new top-level directories,
      new config files at the project root.

## Reactive Context

- [ ] Task-scoped context: when plan-develop starts a task, inject that
      task's acceptance criteria and design constraints (today the whole
      spec must be read manually).

## Spaces

- [ ] `init --from-existing <path>`: build a bare space beside an existing
      checkout without touching it (for users who want to trial the layout
      before converting).
- [ ] Worktrunk bridge: generate a project-level wt config during adopt so
      `wt switch` places worktrees inside the space on machines where the
      user template points elsewhere.
- [ ] Submodule support for conversion (currently a preflight refusal).

## Plan / Gen (Deterministic First)

- [ ] Import external planning formats: Spec-ify, TaskMaster PRD, Kiro →
      the native define/design/tasks structure.
- [ ] Starter-kit templates shipped with the plugin (per stack), not only
      user-authored exemplar templates.

## To evaluate

- [ ] Evaluate and adopt (or not): https://github.com/tokenRollAI/acplugin

## Infrastructure

- [ ] Pin shellcheck version in CI (runner image drift can surface new
      findings unrelated to changes).
- [ ] JSONC-aware validation for tsconfig-style files in CI (currently
      skipped entirely).
- [ ] Test the conversion on Linux (all verification so far ran on macOS;
      everything used is POSIX-portable but unexercised).

## Out of scope (deliberately)

- `hyper watch` / `hyper dash` — need real infrastructure (vector capture,
  dashboards); a plugin stub would lie.
- Anything that deletes or moves user files automatically.
- Detection fallbacks/defaults — absence means unknown, never a guess.
