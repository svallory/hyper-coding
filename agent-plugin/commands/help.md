---
name: help
description: What hyper is, what commands exist, and the standard flow for getting a project set up
argument-hint: ""
---

# Help

Summarize the plugin for the user, then point them at the right first step.
Keep it short — this is orientation, not the manual.

## What to tell the user

**hyper** implements the [Hyper Coding methodology](https://hyperdev.saulo.engineer)
for Claude Code. Two ideas:

1. **Spaces.** A space wraps a project: bare `.git` at the root, every
   checkout under `worktrees/<branch>`, and local-only dirs (`data/` `notes/`
   `scratch/` `bin/`) that can never be committed — dumps, briefs, and
   secrets get a home that is structurally incapable of reaching the remote.
   Space files and project files never mix. A **multi-repo space** wraps
   several repos instead of one: no `.git` at the root, each repo bare under
   `code/<slug>/` with its own `worktrees/`.
2. **Toolchain integration.** The project's *own* linter/typechecker runs
   after every edit and failures feed straight back to the agent — plus
   friction on new dependencies, session context injection, template-driven
   generation, and a lead workflow (`hyper:ship`) that takes a feature from
   request to merged PRs through briefed units.

## Commands

| Command | What it does |
|---|---|
| `/hyper:help` | this page — what the plugin is, all commands, the standard flow |
| `/hyper:init <repo-url>` | create a new space from a remote — or `--new <name>` from nothing — or `--multi <name>` for an empty multi-repo space — or `<repo-url> --slug <slug>` to add a repo to an existing multi-repo space |
| `/hyper:adopt [path]` | bring an existing repo into the layout — scaffolds a bare repo (single- or multi-repo), **converts** an ordinary checkout (dry run first, four data-safety guarantees) |
| `/hyper:tools` | detect the project's toolchain, wire the per-edit check hook, recommend new tools by aspect |
| `/hyper:audit` | read-only health report: drift, debris, stale branches, secrets |
| `/hyper:cleanup` | delete what audit found — candidates listed first, confirmed per item; the one command that deletes |
| `/hyper:gen <template>` | generate files from project templates, verbatim outside marked regions |
| `/hyper:space <args>` | a space's history — dirs committed to the space's branch, pushed to your hyperdrive: init, commit, push, pull, log, status, list, clone — a thin relay over `hyper space` |
| `/hyper:warp <machine>` | move a live session to another machine over ssh — a thin relay over `hyper warp` |

## Skills

Skills are not slash commands. Claude loads one when the request matches its
description; each can also be named directly (the plugin namespace is
`hyper:`, so the first is `hyper:ship`).

| Skill | What it is for |
|---|---|
| `hyper` | layout rules of a space: where files belong, why the root is never committed |
| `hyper-gen` | rules for template-driven generation |
| `hyper-tooling` | detecting a project's toolchain and wiring the check hook |
| `ship` | lead a feature from request to merged PRs: spec decision, briefed units, rulings, landing |
| `spec` | write `define.md` then `design.md` for a feature, each behind a gate |
| `plan` | turn a spec or request into `tasks.md` and one brief per unit, each element checked for a consumer |
| `kickoff` | create the tracker epic and launch the first wave of units |
| `unit` | run one briefed unit through the dev-review driver, or continue a parked one |
| `land` | merge a READY unit and tear down its agents, panes and worktree; or abandon it |
| `auto` | `auto on`: the lead rules instead of asking; `auto off`: review the rulings |

Hooks (automatic): SessionStart context injection inside a space; per-edit
check hook and new-dependency friction hook, both opt-in via
`.claude/hyper.json`.

## The standard flow

For an existing project:

1. `/hyper:adopt` — dry run. Show the user the plan (for an ordinary
   checkout this is a **conversion** — get explicit confirmation), then
   `--apply`.
2. `/hyper:tools` — detect the toolchain, agree on the check commands,
   write `.claude/hyper.json`, and **prove the hook can fail** (inject an
   error, expect exit 2).
3. `/hyper:audit` — periodically, to catch drift and debris.
4. The `ship` skill (or `spec` and `plan` on their own) when starting a
   feature; `/hyper:gen` when the team has patterns worth templating.

For a brand-new setup: `/hyper:init <repo-url>` instead of step 1 — or `/hyper:init --new <name>` when no repo exists yet.

## If the user asks for more

- Layout rules and conventions: the `hyper` skill, or `HYPER.md` in
  their space.
- Domain language and design rules: `docs/concepts.md` in the plugin.
- The ship workflow in full (scripts, config keys, unit files, park states):
  `docs/ship.md` in the plugin.
- What maps to which Hyper Coding pillar: the "Methodology coverage" section
  of the plugin README.
