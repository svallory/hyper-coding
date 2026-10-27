# Changelog

Changes to the hyper agent plugin. The plugin version in
`.claude-plugin/plugin.json` is bumped separately, at release.

## Unreleased

### Added

- `offload` ship config key: a command prefix that runs one shell-string
  argument on a build host in a synced copy of the worktree. When set, the
  rules in the dev and fix prompts send test runs and builds through it (only
  if `command -v` finds the prefix's command, skipping leading `VAR=value`
  words; otherwise they run locally and say so). The dev does not run the
  gate: `ship-loop` and `ship-land` run `gate` literally, so a project that
  wants the gate on the build box writes the prefix into `gate` itself.
  `docs/ship.md` gets a "Running on other machines" section covering
  `offload` and `hosts`.

- `ship-unit resume <ref> --max-rounds N` raises the unit's round limit and
  continues it where it stopped, so a unit that went STUCK for want of rounds
  can be continued. `N` must be above the current limit (else exit 64). The new
  limit is written to `unit.json`, so later resumes keep it; it combines with
  `--model` and `--extend`, and earlier `--model` overrides are kept. The STUCK
  rows in the unit skill and `docs/ship.md` now say so.

- `test-engineer` skill: the test architecture of everything ship builds.
  Rules and budgets (one behaviour, one test, lowest layer; expensive
  fixtures built once per file; deterministic or deleted; affected-only
  while working), a layer decision table, and four procedures: plan the
  tests of a unit before its code exists, review a diff's tests, audit and
  slim an existing suite with a coverage map, set up affected-only runs.
  Reference files `layers.md` (sizes, doubles, seams, determinism, when
  property, snapshot and mutation testing pay, examples for
  TypeScript/vitest, bash and Python), `affected.md` (selection per stack,
  a path-map harness for bash suites, lanes and CI) and `audit.md`.
- The brief template has a required `## Tests` section (a row per behaviour
  with its layer, entry point and fixture, a budget in seconds, the
  affected-run command, the tests not to add). The `plan` skill fills it
  with the `test-engineer` skill and its gate checks it; the `ship` skill
  lists it among the lead rules.

### Changed

- `ship_config_load` merges and validates the config layers in one jq pass: 5 process spawns per load instead of 67 (13x fewer), with the same merged config. Validation is stricter at the edges: a model name with a trailing newline or any whitespace (including non-ASCII) is rejected, an invalid regex under an empty pattern key is rejected, and a caller's non-default `IFS` no longer breaks it.
- Ship finalize now re-runs the stage that rejected a diff after the dev fixes
  it. When a spec check or final gate rejection sends the dev to fix (the
  gate-restore path), that stage judges the fixed diff once the code review is
  READY and before the push; a repeat rejection goes back to the dev under the
  same `max_rounds` cap and ends STUCK with `rejected_by` naming the re-run
  verdict. Units without a spec or final rejection run no extra stage.
- A ship fix round's time budget now grows with the findings it must answer:
  `min(budgets.<class>, budgets.<class> × budgets.fix_fraction + budgets.fix_per_finding × F)`
  minutes, where F is the number of findings (1 for a finalize rejection that
  is only text). The new `budgets.fix_per_finding` key defaults to 2. Before,
  a fix round got a flat `budgets.fix_fraction` of the class budget, so a unit
  with several findings could park OVER-BUDGET while still making progress.

- The driver renders a `{test_skill}` placeholder (the absolute path of
  `skills/test-engineer/SKILL.md`) into the dev rules and the review prompt;
  host mode syncs `skills/test-engineer/` to the host cache so the path
  resolves there too.
  The dev follows the brief's `## Tests` section and reports the affected
  run's command, counts and wall time in its summary; the reviewer runs the
  skill's test checks (wrong layer, overlap, per-case fixtures, missing
  timing, non-determinism, vacuous assertions, unreachable by affected
  selection) as findings.
- `docs/ship.md`: the `gate` row recommends an affected-only command with
  the full suite in CI; the quickstart's brief step names the `Tests`
  section.

## 0.6.2 — 2026-10-26

### Fixed

- `ship-land` deletes the unit's local branch after the squash merge, once the
  branch head is the head of the merged PR. When the PR head cannot be read or
  differs, it keeps the branch and says why.
- `ship-land` refuses a rerun (exit 3) while the PR is still OPEN with
  auto-merge set or in a merge queue, before any rebase, gate, push or merge,
  in local and host mode. The message names the merge state. When the
  merge-queue lookup fails, it warns and goes on.
- `ship-land` no longer accepts `on_land` done entries in the format written
  before 0.6.1, which ignored the PR number.
- `ship-loop`: when the gate or another change outside the dev's fixes puts
  back a diff that a stage rejected, the dev and the next reviewer get that
  stage's findings again, and the unit ends STUCK instead of looping reviewers
  until the guard. `result.json` records `rejected_by`.

## 0.6.1 — 2026-10-26

### Fixed

- Host mode (`--host`) copies the brief, rulings file, spec dir and unit
  directory by any path: spaces, quotes, glob characters and non-ASCII are
  fine; only a newline is refused. The copy back from the host matches glob
  characters literally, so it can no longer mirror a similar-named sibling and
  delete local files.
- Host mode needs rsync 3.0 or newer on both ends and says so: the stock macOS
  openrsync is refused with a message naming the cause.
- Host mode passes the lead's `HERDR_ENV=1` to the host, so the `herdr`
  backend works there.
- `ship-land --host` runs `on_land` on the lead, where the tracker lives, in
  three steps (merge on the host, `on_land` on the lead, teardown on the host).
  A rerun keeps the task saved at the first land and refuses a different
  `--task`; every printed rerun command carries `--task`. `on_land` is checked
  before anything merges, and runs only once the PR is MERGED.
- `ship-loop`: a diff that the spec check or final gate rejected is never
  pushed; each stage's newest verdict on the diff counts on its own. A
  resumed unit no longer loses the lead's answer to an earlier fix round. A
  failed patch-id no longer writes error JSON into signature files.
- Docs from the third clean-room run.

## 0.6.0 — 2026-10-26

### Added

- `hyper:ship`: a lead workflow that takes a request to merged PRs. Step skills
  `spec`, `plan`, `kickoff`, `unit`, `land` and `auto`, each runnable alone.
- `scripts/ship/`: the dev-review driver (`ship-loop`), landing and teardown
  (`ship-land`), role profiles (`ship-role`), config (`ship-config`) and the
  multiplexer seam (`ship-mux`, backends `herdr` and `fake`).
- `ship.yml` settings in three layers: `skills/ship/defaults.yml`,
  `~/.config/hyper/ship.yml`, `<space root>/.hyper/ship.yml`.
- `/hyper:help` lists the skills.

### Removed (breaking)

There is no alias for any of these.

- `/hyper:plan` and its command file `commands/plan.md`. Use the `spec` and
  `plan` skills, or `hyper:ship`.
- `/hyper:team-lead` and its command file `commands/team-lead.md`. Use
  `hyper:ship`.
- The `team` skill (`/hyper:team`, `skills/team/`) and
  `scripts/sync-team-skill.sh`. Use `hyper:ship`. The skill is no longer
  generated from another source.
- The skills `plan-define` and `plan-design` (replaced by `spec`),
  `plan-decompose` (replaced by `plan`) and `plan-develop` (the solo develop
  path is gone; units run through `unit`, and its three rules are in the brief
  template).
- Ship does not read `~/.config/hyper/team-lead/harnesses.yaml`; models are
  per-stage lists in `ship.yml`.
