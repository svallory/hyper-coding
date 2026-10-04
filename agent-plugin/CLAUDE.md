# agent-plugin — rules for working on the hyper plugin

The plugin in this directory ships to users through the `svallory-plugins`
Claude Code marketplace (a `git-subdir` pointer at this path on `main`).
It is bash + markdown with its own test suite and CI. The suite is pure
bash, but it now needs the **hyper CLI on PATH**, because the space-detection
library (`hyper-lib.sh`) lives inside `@hypercli/drive` rather than here —
there is exactly one copy of it, and the scripts source it through
`hyper space lib-path`.

## Hard rules

- **Never develop in `~/.claude/plugins/marketplaces/`.** That clone
  auto-updates and will discard uncommitted work. Develop here, commit, push.
- **Run `agent-plugin/tests/run.sh` before committing.** It discovers every `tests/test-*.sh`;
  `.github/workflows/agent-plugin.yml` enforces the same suite plus
  `bash -n` and `shellcheck --severity=warning` in CI.
- **The CLI must be built before the suite runs**, in dependency order
  (`ui core create-hyper-hq kit hq gen drive cli` — the CLI resolves each
  plugin's `dist/`, and `hq` needs `create-hyper-hq` first):

  ```bash
  bun install
  for pkg in ui core create-hyper-hq kit hq gen drive cli; do
    (cd "packages/$pkg" && bun run build)
  done
  bash agent-plugin/tests/run.sh
  ```

  `tests/helpers.sh` prepends `tests/` to `PATH`; `tests/hyper` is a shim
  that execs `packages/cli/bin/run.js`, so no symlink is needed locally.
  It **must be executable** (`chmod +x`) — as a non-executable file it fails
  with "Permission denied", every script then reports the CLI as missing,
  and the suite fails with hundreds of confusing assertion errors rather
  than one clear one.
- **Never re-add a copy of `hyper-lib.sh` here.** Detection logic belongs in
  `packages/drive`; the plugin shells out to `hyper` (C-1, C-5). To reach a
  library function from a script, source `scripts/hyper-require-lib.sh` and
  call `hyper_require_lib` (or `hyper_soft_lib` in a hook that must stay
  silent when `hyper` is absent). The library enables `set -euo pipefail` when
  sourced: a hook with an always-zero exit contract must reset errexit/pipefail
  afterwards or guard every fallible call. `SessionEnd` gates push on commit
  success, then converts any failure into one diagnostic line and exit zero.
- **Test hooks by piping real hook JSON into the script** — never by running
  the command in your shell, which has an environment hooks don't inherit
  (proto/mise/nvm shims, homebrew PATH):

  ```bash
  echo '{"tool_input":{"file_path":"/abs/path/to/real.ts"}}' \
    | bash agent-plugin/scripts/hyper-check.sh; echo "exit=$?"
  ```

  A hook proves itself with exit 2 on a deliberate error. Exit 0 alone is
  not evidence — a build-cache replay or a silent decline also exits 0.
- **Detection emits only what is verifiable.** Absence means unknown; never
  add a fallback default. A wrong check command fails on every edit and
  trains users to ignore the hook — worse than no check.
- **Nothing deletes or moves user files automatically.** The two exceptions
  are explicit: `adopt --apply` converts (plan first, four verified
  data-safety guarantees), and `/hyper:cleanup` deletes only per-item
  confirmed, re-verified ids.
- **Renames are breaking changes.** The marketplace entry name, command
  prefix, `HYPER.md` marker, `.hyper/` dir, and `.claude/hyper.json` are
  user-facing contract; legacy `hyperdev` names must stay recognized (see
  `tests/test-l-legacy.sh`).
- **Two space layouts.** Single-repo (bare `.git` at the space root) and
  multi-repo (no root `.git`; each repo bare under `code/<slug>/`) are both
  first-class — the marker/layout contract above covers either shape.
  `tests/helpers.sh` has a multi-repo fixture, `make_multi_space`, for
  exercising the second layout in tests.

## Process

- After any substantial change, re-run the clean-room test: give a
  context-free subagent only the goal and this plugin's path, pointed at a
  **messy real project** (live databases, build caches, stray files) — not a
  clean fixture. Treat its findings as hypotheses; reproduce before acting.
  `docs/build-report.md` records both the process and the times it caught
  real bugs (and the times a confident finding was simply wrong).
- Domain language lives in `docs/concepts.md`; the improvement backlog in
  `TODO.md`. Keep both current — vocabulary drift was a real, recurring bug
  source.
