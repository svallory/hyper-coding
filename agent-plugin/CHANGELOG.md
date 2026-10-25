# Changelog

Changes to the hyper agent plugin. The plugin version in
`.claude-plugin/plugin.json` is bumped separately, at release.

## Unreleased

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
