---
name: init
description: Create a new project space — bare repo, worktrees, and local-only directories
argument-hint: <repo-url> [space-name] [--default-branch <name>]
---

# Init

Creates a project space from a git remote: bare clone at `<name>/.git`, no
code at the root, checkouts in `worktrees/`. Local-only dirs sit at the root,
which can never be committed.

## Usage

```
/hyper:init git@github.com:org/repo.git
/hyper:init git@github.com:org/repo.git myname --default-branch develop
```

## What it does

Run the script from the directory that should hold the space:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-init.sh" <repo-url> [name] [--default-branch <b>]
```

It will:

1. `git clone --bare` into `<name>/.git`, then set the standard remote fetch
   refspec and fetch — a bare clone has no remote-tracking branches otherwise.
2. Record `worktrunk.default-branch` and `worktrunk.history` in the repo config.
3. Create `worktrees/ data/ notes/ scratch/ bin/`, each with a
   `.what-goes-here` note.
4. Write `HYPER.md`, seed `.hyper/memory/hyper-layout.md`, and wire
   `autoMemoryDirectory` into the space's `.claude/settings.json`.
5. Create the default-branch worktree via `wt switch`, falling back to
   `git worktree add` when `wt` is unavailable — then write the same
   `autoMemoryDirectory` into that worktree's `.claude/settings.local.json`.

## Space memory

Space memory lives at `.hyper/memory/` and loads through the
`autoMemoryDirectory` key written into the space's `.claude/settings.json`
and the worktree's `.claude/settings.local.json` — settings resolve per
project root, so a session inside a worktree reads the worktree's file.
Claude Code requires the value to be an absolute path, so **moving the space
means re-running `/hyper:adopt --apply`** to refresh it. Project-scope
settings take effect only after the workspace trust dialog is accepted.

## Notes

- Refuses to overwrite an existing path.
- There is no `--layout` flag: spaces have exactly one shape. To bring an
  existing checkout into it, use `/hyper:adopt`, which converts the repo
  rather than cloning it again.
- Worktree placement comes from the user's worktrunk config
  (`worktree-path = "{{ repo_path }}/../worktrees/..."`), which is why the
  script invokes `wt -C <space>` so that template resolves inside it.
- Report the final path and the worktree to `cd` into
  (`<space>/worktrees/<default-branch>`).
