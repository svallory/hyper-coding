# hyper hq list

List available projects and their worktrees.

## Usage

`hyper hq list [flags]`

## Flags

| Flag | Description |
|------|-------------|
| `--root <dir>` | Override the projects root directory |
| `--json` | Output as JSON |

## Examples

```sh
# List all projects
hyper hq list

# Output as JSON (useful for scripting or HQ's internal use)
hyper hq list --json

# List projects from a different root
hyper hq list --root /path/to/projects
```

## Output

The default view shows each project with git and worktree metadata:

```
Projects (/home/user/projects)
──────────────────────────────────────────────────
  my-app  (git, 2 worktrees)
    ├─ main  *  /home/user/projects/my-app
    └─ feat-auth  /home/user/.worktrees/my-app/feat-auth
  another-project  (git)
```

A `*` marks the main worktree.
