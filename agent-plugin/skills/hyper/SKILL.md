---
name: hyper
description: Use when working in or setting up a project space — a bare git repo with worktrees/ and local-only directories. Covers where files belong, why the space root is never committed, and how worktrees are created. Triggers on "space", "worktree layout", "where should this file go", "bare repo", "wt switch".
---

# Project Spaces

A space gives a project a fixed shape: every worktree in one place, plus
directories for files that must never be committed.

A space has exactly one of two layouts, single-repo or multi-repo. In both,
space files and project files never share a directory — project code lives
in a worktree, the space's local-only directories live beside it.

## The layout

**Single-repo** — the space root itself is the bare repo:

```text
<space>/
├── .git/         bare repo — shared object store, no working tree
├── .claude/      settings scoped to this project (wire the space memory)
├── .hyper/    plugin metadata; space memory in .hyper/memory/
├── worktrees/    one worktree per branch, created by `wt switch`
│   ├── main/
│   └── fix-thing/
├── data/  notes/  scratch/  bin/
└── HYPER.md
```

**Multi-repo** — the root holds no `.git`; each tracked repo is its own bare
repo under `code/<slug>/`:

```text
<space>/
├── code/
│   ├── <slug>/
│   │   ├── .git/                bare repo for this repo
│   │   └── worktrees/<branch>/  one worktree per branch
│   └── <slug>/...
├── .claude/      settings scoped to this project (wire the space memory)
├── .hyper/    plugin metadata; space memory in .hyper/memory/
├── data/  notes/  scratch/  bin/
└── HYPER.md
```

There is no repos config file — repos are discovered by globbing
`code/*/.git`.

The root is not a working tree in either layout. Nothing there can be
committed *to the project* — not by accident, not by a stray `git add -A`.
Local-only files get a home structurally incapable of reaching the project's
remote. There is no project `.gitignore` to
maintain and no protection to erode: the safety is structural. Hyperdrive's
separate space-history `.gitignore` is rendered by
the CLI, not maintained by hand.

An ordinary checkout is not a space and cannot be decorated into one.
`/hyper:adopt` **converts** it: the repo becomes bare and the whole working
tree moves to `worktrees/<branch>` — dirty state, untracked files,
`node_modules`, everything. Existing linked worktrees are moved in with
`git worktree move`. The conversion prints its full plan as a dry run, refuses
unsafe states (detached HEAD, rebase/merge/cherry-pick in progress,
submodules), verifies `git status` before and after, and never deletes
anything.

## Am I in one

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hyper-stack.sh" detect   # toolchain
```

For the layout, `hyper space detect <dir> --json` reports it directly
(`layout` is `bare` or `multi`). Note it **exits 1 with an error** when the
directory is not in a space — it does not print JSON with `layout` absent, so
branch on the exit code rather than looking for a missing key. Underneath,
`hyper-lib.sh` — which ships inside the hyper CLI, not in this plugin —
exposes `space_layout <dir>` and
`worktrees_dir <dir> [slug]` (the `slug` is required in a multi-repo space —
there is no single answer without one). Rules of thumb:

- `.git` is a **directory** with `core.bare=true`, with a `worktrees/` dir or
  `HYPER.md` beside it → a single-repo space. A bare repo with *neither* is a
  plain mirror or hosting remote, not a space — `space_layout` prints nothing
  for it.
- `.git` is a **directory**, not bare → an ordinary checkout; not a space
  until `/hyper:adopt` converts it.
- `.git` is a **file** → you are in a linked worktree, not a space root.
- **No** `.git` at the root, `HYPER.md` present, and a `code/` directory →
  a multi-repo space. Repos under `code/` are optional — an empty `code/`
  is still a multi-repo space the moment `hyper init --multi` creates it;
  `space_repos <dir>` lists the slugs actually found (globbing
  `code/*/.git`, bare only).

A plain bare repository is *not* treated as a space until it opts in by having
`HYPER.md` or a top-level `worktrees/`. Without that gate every mirror on
the machine would claim to be one. Same principle for multi-repo: a directory
with no `.git` and no marker is just a directory, never assumed to be a space.

## The corollary

**Until the space has a hyperdrive branch, nothing at the space root is
committed or backed up.** A dump in `data/` exists on exactly one disk. Once
you run `hyper space init`, the allowlisted directories (`notes/`, `data/`,
`bin/`, `.hyper/`, `.claude/`) are committed to the space's branch on your
cadence, and reach your hyperdrive when pushed (`session-end+push`, or
`hyper space push`) — `session-end` and `manual` commit locally and nothing
more. `scratch/`, `worktrees/`, `code/` and loose root files are never
committed. See [Hyperdrive](#hyperdrive).

## Hyperdrive

A space can have its own history: one orphan branch (`space/<name>`, or
`space/<group>/<name>`) in your private hyperdrive repository, committed
from a separate git dir at `.hyper/space.git`. The project's own `.git` is
never touched by this.

**What is tracked.** An allowlist, not a blocklist: `notes/`, `data/`,
`bin/`, `.hyper/`, `.claude/` (except `.claude/settings.local.json`) and the
root control files (`.gitignore`, `HYPER.md`, `AGENTS.md`, `CLAUDE.md`).
`hyper space init --tracked <dir>` adds more
directories — on a space that is already initialised it refuses without
`--refresh`, which re-renders the allowlist and adds to the tracked list.
A peer's new tracked entries are never adopted silently on
pull (it asks, or `--accept-tracked`).

**What never is.** `scratch/`, `worktrees/`, `code/`, loose root files,
`.claude/settings.local.json` and `.hyper/space.git` itself. A staged file
is refused when its **name** matches `.env*`, `*credentials*`, `*.pem`,
`*.key` (and the `~`/`.`-suffixed variants), `id_rsa*`, `id_ed25519*`,
`id_ecdsa*`, `secrets/**`, or when its first bytes hold a
`-----BEGIN … PRIVATE KEY-----` header. There is no token pattern: a file
named `notes/github-token.txt` is committed. `--allow-secret <path>` is the
user's to give for one exact path, never yours to add.

**Cadence.** `hyper.cadence` in the space git dir is the truth:
`manual` (you run `hyper space commit` and `hyper space push`),
`session-end` (each Claude session end commits locally),
`session-end+push` (commits and pushes). The SessionEnd hook returns
at once — a detached worker does the commit and push, so a slow network
never holds the session. A failed save shows up in `hyper space status`,
not in the session.

Pi sessions are saved with `hyper space commit` by hand for now.

**The commands:**

- `hyper space init` — give the current space a branch (first commit, push,
  manifest entry).
- `hyper space commit [-m msg]` / `push` / `pull` — save, publish, fetch.
  Pull is fast-forward only.
- `hyper space log` / `status` — history; state, cadence and upstream.
- `hyper space list` — every space in the hyperdrive manifest.
- `hyper space clone <name> [path]` — recreate a space on a new machine.

**Pull and clone report what can act.** Incoming history is validated
before anything is checked out, and both commands list the incoming files
that can run commands or instruct agents — executables, hooks, and
instruction files (`CLAUDE.md`, `AGENTS.md`, anything under `.claude/`,
`.pi/`, `bin/`, …). Read that list before letting an agent loose in a
freshly cloned or pulled space.

**`hyper warp <machine>`** moves a live session to another machine: the
working directory, the transcript, and an ownership marker go over ssh.
It refuses a session still running here (the agent's own session, often: it
wants `--stop`, which ends it — the user's call), a session another machine
owns or already moved to the target, a leftover marker, a target copy
holding uncommitted work (untracked files included), a target untracked or
ignored entry (a `.env`, say) that the copy would overwrite with different
content or a different type, and, for a plain repo, a target ref this machine
doesn't have or is behind on — the last five are what `--force` overrides.
`--force` on a **space worktree** first saves the target's tracked changes
there as a stash; on a **plain repo** the tracked changes are not saved, its
refs are saved under `refs/hyper-warp-backup/<id>/` when the ref check found
something, and the rest of its `.git` (config, `info/exclude`, hooks) is
replaced by this machine's. In both, the colliding untracked or ignored
entries are first copied to `hyper-warp-backup/<session id>-<start time>/` in
the target repo's git directory (one of a different type is then removed
there), and warp prints where. A merge, rebase, cherry-pick, revert or
bisect in progress, unresolved conflicts, or a changed submodule in the
target's copy are refused even with `--force`. Excluded by default (and never copied): `node_modules`, `_build`,
`deps`, `target`, `dist`, `.turbo`, `.cache`, `.next`. `--dry-run` prints
every step and changes nothing.

**Machines.** `hyper machine setup [name]` brings a machine to parity
(tools, agent user, layout). Hyper never runs sudo unless you pick it:
setup writes every root step into one script and prints it. Without `--yes`
in a terminal it asks — "I've run it" (default), "Run it for me" (runs
`sudo bash <script>`, here or over `ssh -t`, after your password), or "Skip"
— and Skip exits 0 with those tasks reported as skipped. `--yes` asks
nothing about root even in a terminal: it takes the defaults, leaves the
printed script for you, and exits 3 when root steps are pending. The same
happens without `--yes` when there is no terminal.
`hyper drive init` points the CLI at your
private hyperdrive repo; `hyper drive sync-config` keeps `~/.claude` and
`~/.pi/agent` in step between machines.

## Where a file goes

| The file is… | Put it in |
|---|---|
| a DB dump, CSV fixture, tarball, sample dataset | `data/` |
| a review brief, handoff doc, design note, scratch writing | `notes/` |
| output you will not miss tomorrow | `scratch/` |
| a script you run against this project | `bin/` |
| part of the codebase | a worktree — it gets committed |

In a multi-repo space, "a worktree" means `code/<slug>/worktrees/<branch>` —
the local-only dirs are still at the space root, never inside `code/<slug>/`.

When unsure between `notes/` and `scratch/`: if losing it would cost you more
than ten minutes, it is not scratch.

**"hyper X" / "space X" means the space root's `X/`.** When the user says
"hyper notes", "space data", etc., they mean the directory at the space
root — never a same-named directory inside a worktree, even if one exists
there too.

## Rules

- **Never commit from the space root.** The bare repo has no index in the
  usual sense; `cd` into a worktree first.
- **Create worktrees with `wt switch <branch>`**, not `git worktree add`. The
  user's worktrunk config controls placement and strips branch prefixes, so
  `fix/foo` becomes `worktrees/foo`. Doing it by hand puts the tree in the
  wrong place and skips post-start hooks (dependency install, hooksPath fix).
- **`scratch/` is disposable.** Anything there may be deleted without warning.
- Worktrees have their own `.claude/` and `CLAUDE.md`; those *are* committed.
  Space-level `.claude/` is local and shared across all worktrees. Space
  memory lives in `.hyper/memory/`, wired via `autoMemoryDirectory` in the
  space's `.claude/settings.json` and each worktree's
  `.claude/settings.local.json` (the value must be absolute — moving the
  space means re-running `/hyper:adopt --apply`).

## Which command, in what order

There is no single "set this project up" command. For an existing project:

1. `/hyper:adopt <path>` — dry run first, read the output. On an ordinary
   checkout this prints a **conversion plan** (every root entry and where it
   moves); on a bare repo it lists what would be scaffolded.
2. For a conversion, walk the user through the plan and get explicit
   confirmation. For a bare space, act on the loose-file suggestions **one at
   a time**, confirming each — they are heuristics; several categories are
   explicitly "leave in place".
3. `/hyper:adopt <path> --apply` — convert, or create the scaffold.
4. `/hyper:tools <path>` — detect the toolchain and wire the check hook.
5. `/hyper:audit <path>` — the judgement checks, any time after.

`/hyper:init` is only for creating a *new* space from a remote. It does
not apply to a project that already exists on disk.

Nothing in the plugin deletes anything, with one controlled exception:
`/hyper:cleanup` deletes what audit classifies as debris — orphaned
worktrees, parked leftovers, gone branches, scratch contents — one explicitly
confirmed id at a time, re-verified at deletion time.

## Commands

- `/hyper:help` — orientation: what the plugin is, all commands, the
  standard flow. Point new users here first.
- `/hyper:init <repo-url> [name]` — create a new space
- `/hyper:init --multi <name>` — create a new, empty multi-repo space
- `/hyper:init <repo-url> --slug <slug>` (or `--new <name> --slug <slug>`) —
  from inside an existing multi-repo space, add a repo at `code/<slug>/`
- `/hyper:adopt [path] [--apply]` — scaffold a bare repo into a space, or
  convert an ordinary checkout into one; at a directory that already looks
  multi-repo, scaffold it additively (see [`/hyper:adopt`](../../commands/adopt.md))
- `/hyper:audit [path]` — report drift, read-only. The mechanical checks
  are scripted (`hyper-audit.sh`); judging each finding is not.
- `/hyper:cleanup [path]` — the audit-findings executor and the one
  command that deletes: lists candidates with stable ids, deletes only ids
  named explicitly, each confirmed per item and re-verified before `rm`.
- `/hyper:tools [path]` — detect the project toolchain and wire the
  check hook. See the `hyper-tooling` skill; the commands are
  project-specific and must be detected or asked about, never assumed. The
  same config file gates the deps friction hook, which asks for one sentence
  of justification when an edit adds a new dependency.
- `/hyper:plan <feature> [phase]` — the four-phase spec workflow: Define,
  Design, Decompose, Develop. Artifacts live under `notes/specs/`.
- `/hyper:gen [template] [dest]` — generate files from a project template;
  deterministic copy, agent authoring only inside marked prompt regions.

## Detecting a space

See "Am I in one" above for the layout rules. `HYPER.md` is the
explicit marker, but a single-repo space is also recognised from structure
alone — a bare `.git` with a top-level `worktrees/` beside it — so spaces
predating this plugin still work without the marker. A multi-repo space has
no such structural fallback for `space_layout`: it requires `HYPER.md` (or
the legacy `HYPERDEV.md`) plus a `code/` directory — `/hyper:adopt`, unlike
`space_layout`, *does* recognize an unmarked multi-shaped directory (see
`/hyper:adopt` case C) and writes the marker as part of scaffolding it.

To find the root from anywhere inside, walk up until that shape appears. A
linked worktree has a `.git` *file*, so it is skipped and the walk continues to
the real root. In a multi-repo space, `find_space_root` resolves from inside
`code/<slug>/worktrees/<branch>/...`, from `code/<slug>/`, from a local-only
dir, or from the root itself — except a brand-new `--multi` space with no
repos yet, which only resolves from the root (nothing under `code/` to walk
up through). When `cwd` is the root itself, take extra care — that is where
commits and loose files go wrong.

## Worktrunk interaction

Placement comes from the user-level worktrunk config, roughly:

```toml
worktree-path = "{{ repo_path }}/../worktrees/{{ branch | replace('fix/', '') | ... | sanitize }}"
```

`repo_path` is the worktree `wt` runs from, so `../worktrees/` resolves to the
space's `worktrees/`. Because this is user-level, it applies to every
project — a space must use that directory name for `wt` to work correctly.

Worktrees of a bare repo get a `.git` *file* rather than a directory, which
breaks relative `core.hooksPath`. The worktrunk `post-start` hook fixes it with
`git config core.hooksPath "$(git rev-parse --git-common-dir)/hooks"`.

In a multi-repo space, `repo_path` is `code/<slug>/`, so the same config
resolves to `code/<slug>/worktrees/<branch>` — which is why `wt switch` has
to run from inside `code/<slug>/` (or one of its worktrees): worktrunk
resolves the repo from cwd, and cwd at the space root has no repo to resolve.
