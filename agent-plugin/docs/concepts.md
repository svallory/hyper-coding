# Concepts

The domain language of the hyper plugin. Every term here has one meaning;
scripts, skills, and commands are expected to use these words and no others.
(The core concept was renamed from "container" to "space" on 2026-08-03 —
if you find "container" anywhere in the plugin, it is a bug.)

---

## Space

A **space** is the fixed directory shape hyper gives a project: the git
repository, every worktree of it, and a small set of local-only directories,
all under one root.

A directory is a space when `space_layout` (in `scripts/hyper-lib.sh`)
classifies it — that function is the single authority. Its invariants:

- The root contains `.git` as a **directory** (a `.git` *file* means a linked
  worktree, which is never a space — see [Worktree](#worktree)).
- The `.git` at the root is **bare**, with the space structure beside it (see
  [Marker](#marker-hypermd-and-the-opt-in-gate)).
- Exactly one space root exists per project; `find_space_root` walks upward
  from anywhere inside and stops at it.

What a space is *for*: one object store shared across branches, one canonical
home for worktrees, and a place for files that must never reach the remote.
The corollary: **nothing local-only is backed up** — a dump in `data/` exists
on exactly one disk.

## Layout

A space has exactly one shape. `space_layout` prints `bare` or nothing.

```
<space>/
├── .git/         bare — no working tree
├── .claude/      settings (wire the space memory via autoMemoryDirectory)
├── .hyper/    plugin metadata; space memory in .hyper/memory/
├── worktrees/    one working tree per branch
├── data/  notes/  scratch/  bin/
└── HYPER.md
```

Detection: `.git` is a directory with `core.bare=true`, **and** either a
`worktrees/` directory or `HYPER.md` sits beside it. The extra requirement
exists so a plain bare clone — a mirror, a hosting remote — is not mistaken
for a space.

The core design rule alongside [the verifiability rule](#the-design-rule):
**wrapping, never mixing.** Space files and project files never share a
directory. The project lives entirely inside `worktrees/<branch>`; the space's
local-only files live beside it, outside every working tree. There is no
"decorated checkout" variant where space directories sit inside the repository
root — that shape mixes space files into the project, and it is exactly what
adoption converts away from.

Safety property: **structural impossibility.** The root is not a working tree;
there is nothing to `git add` and no commit can include it. Local-only files
cannot reach the remote by construction — not by accident, not by a stray
`git add -A`. There is no `.gitignore` protection to maintain, because there
is nothing to protect against: that is the point of the single shape.

## Marker (HYPER.md) and the opt-in gate

`HYPER.md` is the explicit, human-readable marker that a project has
adopted the space conventions. It documents the layout for whoever opens the
directory, and it is the opt-in signal detection looks for.

Why a gate at all: `core.bare=true` alone matches mirrors and hosting
remotes, so `space_layout` requires the promised structure (`worktrees/`) or
the marker beside `.git`. Structural detection is the fallback that keeps
bare spaces predating this plugin working without the marker.

`adopt` is the one code path allowed to accept a repository the gate rejects,
because adopt is the thing that performs the opt-in: a plain bare repo is
scaffolded in place, and an ordinary checkout is **converted** into the space
shape (see the `/hyper:adopt` command).

## Worktree

A **worktree** is one working tree of the space's repository, one per branch,
living in `worktrees/` — `worktrees_dir` resolves the path. Created with
`wt switch <branch>` (worktrunk), never `git worktree add` by hand, so
placement and post-start hooks are consistent.

**A linked worktree is never itself a space.** The distinguishing fact is
mechanical: a linked worktree has a `.git` **file** (pointing at the shared
repository), not a `.git` **directory**. `git rev-parse --show-toplevel`
happily reports the worktree as the top of its own tree, and a worktree can
carry a tracked copy of `HYPER.md` — so both the "is a repo root" and "has
the marker" tests can pass on it. The `.git`-must-be-a-directory rule is what
rejects it, which is also what lets `find_space_root` walk *through* a
worktree up to the real space root.

Worktrees have their own `.claude/` and `CLAUDE.md`, and those are committed;
the space-level `.claude/` is local and shared across all worktrees.

Space memory lives at `.hyper/memory/` — `.hyper/` is the plugin's
tool-agnostic metadata home at the space root. Claude Code does not read that
directory on its own; the scaffold wires it via `autoMemoryDirectory` in the
space's `.claude/settings.json` and each worktree's
`.claude/settings.local.json` (settings resolve per project root, so a
worktree session reads the worktree's file). The value must be an absolute
path, which is why moving a space calls for a re-run of
`/hyper:adopt --apply`.

## Local-only directories

`SPACE_DIRS=(worktrees data notes scratch bin)` in `hyper-lib.sh` is the
single source of truth for the set. The four non-worktree members:

| Dir | Purpose | Loss tolerance |
|---|---|---|
| `data/` | DB dumps, fixtures, large blobs | would hurt to lose — but still not backed up |
| `notes/` | briefs, handoffs, working docs, plan specs | same |
| `scratch/` | throwaway files | disposable; may be deleted without warning |
| `bin/` | local helper scripts for this project | same as data |

Rule of thumb between `notes/` and `scratch/`: if losing it would cost more
than ten minutes, it is not scratch.

They sit at the space root, which is not a working tree — they are
uncommittable by construction and never reach the remote. Nothing in them is
committed **or backed up**. And nothing in the plugin ever moves or deletes
their contents — `adopt` *suggests* where loose files belong; a human acts.

## Stack

A **stack** is a detection module: a directory `stacks/<name>/` containing a
`detect.sh` that defines exactly two functions:

- `stack_matches <dir>` — exit 0 when this stack applies to the project.
- `stack_detect <dir>` — print `KEY=VALUE` facts about the project's
  toolchain: `STACK`, `PM`, `PM_RUN`, and entry points like `LINT`,
  `TYPECHECK`, `TEST`, `FORMAT`, `LINT_TOOL`.

`scripts/hyper-stack.sh` is the dispatcher: it discovers stacks by
directory scan (adding one changes no existing file), sources each in a
subshell, and lets the **first match win** — other matches are appended as a
`# also matches:` comment so polyglot repos stay visible.

The contract that matters: **emit a key only when it is verifiable in the
project.** A missing `LINT` means "no lint entry point exists", which is an
answer, not a gap to fill. With no lockfile the package manager is `unknown`
and consumers (the check hook) decline to act rather than defaulting to npm —
which would rewrite a bun project's lockfile. See
[the design rule](#the-design-rule).

Note the vocabulary split: the *stack* is the detection module; the
*toolchain* is what it reports about — the project's own package manager,
linter, typechecker. That is why the SessionStart hook's summary line is
labelled `Toolchain:` even though it opens with the stack name (`STACK` is
one of the reported facts): the line describes the project's tools, not the
module that detected them.

## Check

The **check** is the `PostToolUse` hook (`scripts/hyper-check.sh`,
registered in `hooks/hooks.json` for `Edit|Write|NotebookEdit`): after each
edit it runs the project's *own* linter or typechecker and feeds failures
straight back to the agent.

Invariants:

- **Off by default.** It runs only when the project opts in via
  `.claude/hyper.json` with a `check` object (or `checks` array), found by
  walking up from the edited file. No config, no run.
- **Never guesses.** An unparseable config, an unknown package manager, or a
  `run` name with no resolvable runner all make the hook silently decline.
- **Extension-filtered.** `extensions` limits which files trigger it; editing
  a README does not typecheck the repo.
- **Exit-2 feedback contract.** Exit 0 means clean (or not applicable). Exit
  2 sends stderr back to the agent as actionable feedback — the failing
  command's tail, or an explicit "timed out" / "command not runnable" message
  so nobody chases a type error that never happened. No other failure mode
  exists: environment problems (no `timeout` binary, no node) degrade to
  silence, never to a false failure.
- **Hooks do not inherit the user's shell.** No proto/mise/nvm shims, maybe no
  homebrew PATH. Configs should prefer project-local binaries
  (`./node_modules/.bin/tsc`), and relative paths resolve against the
  directory holding the config — so in a bare space the config belongs in the
  worktree, not the space root.
- A configured check must be **provably able to fail**: exit 0 under a build
  cache is not evidence it ran.

The same config file also gates the **deps** hook (see
[Engineered Friction](#the-hyper-coding-pillars) below).

## The design rule

> **Report only what is verifiable. Absence means unknown, never a default.**

This is the governing principle; most of the code is downstream of it.

- Detection omits keys it cannot prove. A wrong check command is worse than
  no check command.
- The check hook declines to run rather than guessing a runner.
- Nothing ever deletes user files, and no heuristic ever moves one — `adopt`'s
  loose-file scan and `audit` report; a human acts. The one controlled
  exception is `/hyper:cleanup`, which deletes only what audit classifies
  as debris, only ids named explicitly, each confirmed per item and
  re-verified at deletion time. (The one time a heuristic
  nearly acted on its own it would have silently emptied a live SQLite
  database.) The single moving operation, converting a checkout into a space,
  is not a heuristic: it moves *everything* to `worktrees/<branch>`, prints
  its full plan first, and verifies `git status` matches afterwards.
- Any failure path added to a hook must be impossible to hit on a healthy
  project.

The failure mode all of this avoids: a check that fails on every edit gets
ignored within a day, and the real failures get ignored with it.

## The Hyper Coding pillars

The plugin is an implementation, at Claude Code plugin scale, of the five
[Hyper Coding](https://hyperdev.saulo.engineer) pillars. The mapping:

| Pillar | Plugin feature |
|---|---|
| Tools Integration + Real-time Feedback | check hook |
| Reactive Context | SessionStart hook |
| Engineered Friction | deps hook + plan-develop gate |
| Deterministic First | gen templates |

**Tools Integration + Real-time Feedback → check hook.** The agent gets the
same linter/typechecker signal a human gets from their editor, at the moment
the mistake is made rather than at review. Described above under
[Check](#check).

**Reactive Context → SessionStart hook.** `scripts/hyper-context.sh` tells
each new session *where it is* (space root vs worktree vs local-only dir,
with the warnings each location needs) and *how to work here* (detected
toolchain facts and check-hook status). Silent outside a space, so it costs
nothing in unrelated projects.

**Engineered Friction → deps hook + plan-develop gate.** Friction is placed
where a cheap decision has expensive consequences. The deps hook
(`scripts/hyper-deps.sh`, opt-in via `"deps": {"enabled": true}`) notices
when an edit adds a *new* dependency to a manifest and asks — once per
dependency per session — for one sentence of justification. The plan-develop
gate is the Develop phase of hyper plan: tasks execute one at a time, each
validated against `define.md` criteria and `design.md` constraints before it
is marked done, and disagreeing with the design costs a written entry in
`deviations.md`. In both, the easy path is compliance; deviation costs a
sentence.

**Deterministic First → gen templates.** If it can be done deterministically,
don't LLM it. `/hyper:gen` copies new files from a project template with
placeholder substitution; the agent authors only inside regions the template
explicitly opens. There is no engine — the command instructs the agent — but
templates keep a format a real generator could consume later.

The plan phases themselves (`/hyper:plan` → Define, Design, Decompose,
Develop, one skill each) are the methodology's spine: each phase produces an
artifact (`define.md`, `design.md`, `tasks.md`, then code + `deviations.md`)
that the next phase consumes, with artifacts living under
`notes/specs/<feature-slug>/` in the space.
