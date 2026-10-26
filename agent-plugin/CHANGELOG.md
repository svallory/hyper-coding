# Changelog

Changes to the hyper agent plugin. The plugin version in
`.claude-plugin/plugin.json` is bumped separately, at release.

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
