# @hypercli/drive

Hyperdrive plugin for the `hyper` CLI: one private repository holding every
space's history, `warp` (move a session between machines), config sync, and
machine setup.

## Install

Included automatically with the `hyper` CLI. Can also be installed as a
standalone oclif plugin.

## Concepts

A **hyper space** is a project directory with a bare layout (see the hyper
agent plugin). Hyperdrive gives each space its own history: an orphan branch
(`space/<name>` or `space/<group>/<name>`) in your private hyperdrive
repository, committed from a separate git dir at `<space>/.hyper/space.git`.
The project's own `.git` is never touched.

Tracking is an **allowlist**, not a blocklist: `notes/`, `data/`, `bin/`,
`.hyper/`, `.claude/` and the root control files (`.gitignore`,
`HYPER.md`, `AGENTS.md`, `CLAUDE.md`). `scratch/`, `worktrees/`, `code/`,
loose root files, `.claude/settings.local.json` and the space's own git dir
never travel, and a staged file that looks like a secret
makes the commit refuse unless you allow that exact path. Extra directories
join the list with `hyper space init --tracked <dir>`.

## First machine

```bash
# 1. Point the CLI at your private hyperdrive repository.
hyper drive init --remote git@github.com:you/hyperdrive.git

# 2. Give a space a branch and pick its cadence.
cd ~/spaces/my-project
hyper space init --cadence session-end
```

Cadence is `manual` (you run `hyper space commit` and `push`), `session-end`
(each Claude session end commits locally; the hook returns at once and a
detached worker commits, so a slow network never holds the session) or
`session-end+push` (commits and pushes). Only `session-end+push` and an
explicit `hyper space push` put the history on the hyperdrive — under
`session-end` or `manual` the history sits in `.hyper/space.git` on this disk.
A failed save shows in `hyper space status`.

Pi sessions get the same save from the extension in `packages/drive/pi`
(`pi install packages/drive/pi`): on `session_shutdown` it writes the payload
and starts the same detached worker, so a pi session end commits locally — and
pushes for `session-end+push` — without holding pi's exit. Its commit subject
is the session name, or the first line of the first prompt, so prompt text
lands in the space's history. With `manual`, or with the extension not
installed, a pi session is saved with `hyper space commit` by hand.

## Second machine

```bash
# 1. Same drive init (per-machine config lives in ~/.config/hyper/drive.toml).
hyper drive init --remote git@github.com:you/hyperdrive.git --name laptop

# 2. Recreate the space. The default destination is the recorded path
#    remapped under this HOME; confirm it or pass one explicitly.
hyper space clone my-project --yes

# 3. Optional: keep ~/.claude and ~/.pi/agent in step between machines.
hyper drive sync-config mac
```

Pull and clone treat incoming history as untrusted: they validate it before
checkout and **report the files that can run commands or instruct agents**
(executables, hooks, `CLAUDE.md`/`AGENTS.md`, anything under `.claude/`,
`.pi/`, `bin/`). Read that list before letting an agent loose in a freshly
cloned or pulled space.

## Commands

### `hyper space` — a space's own history

```
hyper space init [DIR] [--name n] [--group g]
                 [--cadence manual|session-end|session-end+push]
                 [--tracked dir...] [--refresh] [--json]
```

Detect the space, refuse a branch-name clash on the remote, create
`.hyper/space.git`, render the allowlist, make the first commit, push, and
record the space in the manifest. `--refresh` re-renders an
already-initialised space (adds `--tracked` entries; never removes).

```
hyper space commit [-m msg] [--allow-secret path...] [--json]
```

Stage per the allowlist, run the secret guard, commit when the index
differs from HEAD. `--session-end` / `--payload-file` serve the detached
SessionEnd worker; you never need them by hand.

```
hyper space push
hyper space pull [--accept-tracked] [--json]
hyper space log [git-log args…]
hyper space status [--fetch] [--json]
hyper space list [--json]
```

Push never rewrites remote history; pull is fast-forward only and never
silently adopts a peer's new `tracked` entries (it asks, or takes
`--accept-tracked`). Status is offline unless `--fetch` — it compares
against the last-seen remote-tracking ref.

```
hyper space clone NAME [PATH] [--yes] [--json]
```

Recreate a space from the hyperdrive on this machine. Validates the
manifest entry and the incoming branch, then clones the project's
repositories and restores the cadence/tracked settings. Worktree placement
is your worktrunk setting (`worktree-path`); clone inspects it read-only
and warns with the actual destination — it never edits your config.

Also: `hyper space detect [DIR] [--json]` (which space a directory belongs
to; exits 1 outside one) and `hyper space lib-path` (path of the shared
bash library the agent plugin sources).

### `hyper warp` — move a session between machines

```
hyper warp MACHINE [--session id] [--stop] [--remote-control]
             [--force] [--dry-run] [--json]
```

Send only: the machine holding the session runs it. Copies this session's
transcript and the working directory to the same absolute path on MACHINE
over ssh, then resumes through Herdr. Every check runs before the first
change on either machine.

Warp refuses, without `--force`, when the session is owned by
another machine or already lives on the target, when a leftover marker makes
ownership unknown, when the target's worktree or repo has uncommitted
work (including untracked files), when the copy would overwrite an
untracked or ignored entry there (a `.env`, say) with different content or
with a different type (a file or symlink on one side, a directory on the
other); identical files and excluded paths don't count. For a plain repo it
also refuses when the target has a ref this machine doesn't have, or one
with commits this machine's ref doesn't contain (or a detached HEAD this
machine's HEAD doesn't contain). With `--force`, a dirty space worktree's
tracked changes are first saved on the target in a stash (a plain repo's are
not saved); a plain repo's refs (and a detached HEAD) are first saved there
under `refs/hyper-warp-backup/<session id>-<start time>/` when that check
found something; and every colliding untracked or ignored entry is first
copied (`cp -pPR`) to `hyper-warp-backup/<session id>-<start time>/` inside
the target repo's git directory (that directory and its parent mode 0700),
an entry of a different type then removed there (a symlink is removed, not
followed); warp prints where and how many. It
refuses, whatever `--force` says, when the session is still running here
(only `--stop` gets past that, and it ends that process), when the space is
missing from the hyperdrive manifest, a path cannot be quoted identically on
both platforms, the target's Herdr server does not answer, the target would
reject the branch push, or the target's worktree or repo has a merge,
rebase, cherry-pick, revert or bisect in progress, unresolved conflicts, or
a changed submodule. `--dry-run` prints every step and changes
nothing.

### `hyper machine` — bring a machine to parity

```
hyper machine setup [MACHINE] [--features f,...] [--tools t,...|"all"]
                    [--yes] [--agent-key key.pub]
hyper machine add NAME [--home path] [--features f,...] [--agent-user u]
hyper machine list [--json]
```

Setup is idempotent per task and **never runs sudo unless you choose it**:
root steps are written to one script (mode 0700) and printed. Without
`--yes` in a terminal it asks what to do — "I've run it" (the default),
"Run it for me (asks for your password)", which runs `sudo bash <script>`
locally or over `ssh -t`, or "Skip"; Skip there is a deliberate answer, so
the run exits 0 with those tasks reported as skipped. `--yes` asks nothing
about root even in a terminal: it takes the defaults, leaves the printed
script for you and exits 3 when root steps are pending. Without a terminal
the same happens without `--yes`. Machines are the Herdr machine list merged
with `[machines.*]` in `drive.toml`.

### `hyper drive` — the hyperdrive itself

```
hyper drive init [--remote url] [--name n] [--home path]
hyper drive status
hyper drive sync-config [MACHINE] [--check] [--json]
```

`drive init` writes `~/.config/hyper/drive.toml` and clones the manifest.
`sync-config` keeps `~/.claude` and `~/.pi/agent` in sync with another
machine (Mutagen sessions); with no argument it lists them, `--check` only
verifies and exits 1 on a mismatch.

## Configuration

One user config file: `~/.config/hyper/drive.toml`. Set
`HYPER_DRIVE_CONFIG=<path>` to override the location (used by tests and
tooling).

## Known limits

- **Nothing at a space root is committed or backed up until it has a
  hyperdrive branch** (`hyper space init` on the first machine, `hyper space
  clone` on another).
  The generated `HYPER.md` says which case applies as of when it was written;
  `hyper space status` is the live answer.
- **Warp overwrites the target's copy file by file, with no `--delete`:**
  files that exist only on the target are kept. For a plain directory (no
  `.git` on the target) nothing is compared and nothing is saved first.
  Ignored files inside a submodule of the target are not looked at.
- **A plain repo's `.git` is merged file by file too:** the target's
  `.git/config`, `info/exclude`, hooks, `HEAD`, index and `packed-refs` are
  replaced by this machine's. Saved refs under `refs/hyper-warp-backup/` stay
  safe from later warps only while they are loose ref files: once `git
  pack-refs` (or `gc`) packs them, the next plain-repo warp replaces
  `packed-refs` and drops them.
- **The collision comparison has a 5-minute limit** (about 3,000 files per
  6 s, measured in a container): past roughly 100,000 candidate files warp
  refuses with "couldn't compare".
- **rsync's quick check** skips a file whose size and modification time
  (to the second) match, so a target file backed up as a collision can be
  left in place, unchanged, when only its content differs.
  Staged-but-uncommitted
  changes arrive as unstaged modifications — the index does not travel.
  The way back is warp from the other machine, which requires this machine
  to be reachable from there (tailnet or a reverse tunnel).
- **A machine on a non-default ssh port** is not reachable as a `host:port`
  target; register it through an ssh config alias instead.
- **The manifest is last-writer-wins by space name** — two machines
  registering the same name at once resolve to whichever push lands last.
- **"Backed up" only means pushed.** `session-end` and `manual` cadence
  commit to `.hyper/space.git` on the same disk; the history reaches the
  hyperdrive only through `session-end+push` or `hyper space push`.
- **Session-end saves cover Claude sessions.** Pi sessions are saved with
  `hyper space commit` by hand for now.
- **Incoming `tracked` entries widen what this machine uploads** — that is
  why pull asks instead of adopting them.

## Machine setup

`hyper machine setup <machine>` checks each selected feature, applies unprivileged steps, and prints any remaining root steps as a script for you to read. **Run that script from a root console or a sudo session of your own**; hyper never runs it as root without your explicit choice at the prompt. If a home move is pending, use a root console with the primary user's sessions closed — the move cannot run from that user's own SSH session.

The root script may restart `user@<uid>.service` **only if the primary user's running `systemd --user` manager lacks the new `collab` group**. That restart stops **all of the primary user's user services at once**, including any rootless containers the user runs, so they are down for the moment it takes; enabled units, including the transcript watcher, start again, and containers come back only if a restart policy or a user unit restarts them. A stopped or already-correct manager is left alone, so a second setup is a no-op. If this run installs `docker-ce`, the script also stops and disables the new system-wide Docker daemon; an existing `docker-ce` is reused and its daemon left alone, while any other Docker engine (docker.io, snap, …) makes setup refuse and change nothing.

## Documentation

Full documentation at [hyperdev.saulo.engineer](https://hyperdev.saulo.engineer).

## License

MIT
