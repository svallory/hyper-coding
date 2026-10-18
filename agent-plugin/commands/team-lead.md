---
name: team-lead
description: Alias for /hyper:team — lead developer agents through a batch of tasks (decompose, assign the cheapest adequate model, review, track)
argument-hint: "[tasks, board, epic or brief]"
---

# Team lead

Alias for `/hyper:team`, kept so the name the standalone team-lead plugin
taught still works. Invoke the **team** skill (`skills/team/SKILL.md` in this
plugin) and follow it exactly, with the user's arguments as the batch to
lead. This command adds no logic of its own.

Harness choices and routing are read from and saved to
`${XDG_CONFIG_HOME:-$HOME/.config}/hyper/team-lead/harnesses.yaml` — the
same file the standalone team-lead plugin uses, so an existing setup carries
over unchanged.

The skill is generated from the claude-plugins source by
`agent-plugin/scripts/sync-team-skill.sh`; change it there, then re-sync.
