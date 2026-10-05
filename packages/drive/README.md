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

Claude Code's own per-user state is never committed, under the space's
`.claude/` or any other `.claude/` in it, in case Claude was ever pointed at
one as its config dir: credentials, `.claude.json*`, `history.jsonl`,
`projects/`, `todos/`, `session-env/`, `shell-snapshots/`, `plugins/`,
caches, logs and the rest (`CLAUDE_USER_STATE`: every entry config sync
ignores plus the history and transcripts it syncs). Everything else in
`.claude/` travels: `settings.json`, `commands/`, `agents/`, `skills/`,
`hooks/`, `rules/`, `CLAUDE.md` and your own files. This is enforced at
every commit, not by `.gitignore`: user state is never staged, and user
state an older version committed is untracked by the next commit (one
`note:` line, files kept on disk; earlier commits still hold it, so treat a
secret that was in it as exposed). `--allow-secret` does not override it. A
pull refuses history that adds or changes user state, naming the path and
the commit: update hyper on the machine that pushed it and commit there.

## First machine

```bash
# 1. Point the CLI at your private hyperdrive repository.
hyper drive init --remote git@github.com:you/hyperdrive.git

# 2. Give a space a branch and pick its cadence.
cd ~/spaces/my-project
hyper space init --cadence session-end
```

Cadence is `manual` (you run `hyper space commit` and `push`), `session-end`
(each Claude or pi session end commits locally; the hook returns at once and a
detached worker commits, so a slow network never holds the session) or
`session-end+push` (commits and pushes). Only `session-end+push` and an
explicit `hyper space push` put the history on the hyperdrive — under
`session-end` or `manual` the history sits in `.hyper/space.git` on this disk.
A failed save shows in `hyper space status`.

Pi sessions get the same save from the extension in `packages/drive/pi`
(`pi install "$PWD/node_modules/@hypercli/drive/pi"`): when a pi session
quits, it asks the CLI which space it is in and what that space's cadence is —
one read-only call, measured at 200 to 700 ms, killed at 5 s — then writes
the payload and starts the same detached worker, so the session end commits
locally, and pushes for `session-end+push`, while pi waits only for that one
call. A call that overruns 5 s saves nothing and leaves a `failed` "probe
timed out" line that `hyper space status` shows. That line is written only into
a real space git dir above the session's directory (`.hyper` and `space.git`
real directories, not symlinks, holding `HEAD` and `config`; the log itself is
never followed through a symlink), and a `manual` space gets it too, because
the cadence was never read. The commit subject is the
session name, or the first line of the first prompt, so prompt text lands in
the space's history. `/new`, `/resume`, `/fork` and `/reload` do not end the
work and save nothing; with `manual`, or with the extension not installed, a
pi session is saved with `hyper space commit` by hand. The probe runs on every
quit either way — that is how the extension knows — and with no saving space
it saves nothing and prints nothing. From the npm package the directory is
`node_modules/@hypercli/drive/pi`.

`hyper space detect --json` also reports a space's `spaceGitDir` and its
`cadence`, which is how a caller that may not run commands in a space learns
what it is in.

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
repositories, restores the cadence/tracked settings, and records this
clone's path in the manifest when it differs from the recorded one. Worktree placement
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
other), or when the target has a directory git tracks where this machine
has a file or symlink; identical files and excluded paths don't count (a
tracked file there where this machine has a directory is not refused: git
has it, and the copy replaces it). For a plain repo it also refuses when a
target ref (or a detached HEAD) points at a commit this machine doesn't
have, or has but reaches from none of the refs warp carries (its branches,
tags and other refs, and HEAD; not earlier warps' backups, other worktrees'
HEADs or the stash); a ref only the target has (a remote-tracking ref or a
tag it fetched more recently) passes when its commit is reachable that
way, and is then removed there. With `--force`, a dirty space worktree's
tracked changes are first saved on the target in a stash (a plain repo's are
not saved); a plain repo's refs (and a detached HEAD) are first saved there
under `refs/hyper-warp-backup/<session id>-<start time>/` when that check
found something; and every colliding untracked or ignored entry, and every
tracked directory where this machine has a file, is first copied (`cp -pPR`) to `hyper-warp-backup/<session id>-<start time>/` inside
the target repo's git directory (that directory and its parent mode 0700),
an entry of a different type then removed there (a symlink is removed, not
followed); warp prints where and how many. That also puts right a target an
older warp left half-way (its `.git` already this machine's, the directory
still there). It refuses, whatever `--force` says, when the session is still running here
(only `--stop` gets past that, and it ends that process), when the space is
missing from the hyperdrive manifest, a path cannot be quoted identically on
both platforms, the target's Herdr server does not answer, the target would
reject the branch push, or the target's worktree or repo has a merge,
rebase, cherry-pick, revert or bisect in progress, unresolved conflicts, or
a changed submodule, or (a plain repo) keeps its refs in the reftable format
(`extensions.refStorage=reftable`), has a ref lock file (named in the
refusal), or has a `.git` that is a `gitdir:` file. `--dry-run` prints every step and changes
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
the same happens without `--yes`. The `config-sync` feature creates (or
verifies) the same two sessions as `hyper drive sync-config MACHINE`, so a
second run reports nothing needed; it pairs two machines, so on the local
machine (no MACHINE) it only says how to pair and is reported skipped. Machines are the Herdr machine list merged
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
  The generated `HYPER.md` says which case applies as of when it was written,
  and `hyper space init` (and `--refresh`) re-renders that one bullet in the
  commit it makes, unless you edited it; `hyper space status` is the live
  answer.
- **Warp overwrites the target's copy file by file, with no `--delete`:**
  files that exist only on the target are kept. For a plain directory (no
  `.git` on the target) nothing is compared and nothing is saved first.
  Ignored files inside a submodule of the target are not looked at.
- **A plain repo's `.git` is copied on its own, then its refs are synced:**
  the `.git` copy excludes nothing but earlier warps' backups (your
  `warp.exclude` patterns apply to the working tree only, so a branch named
  `dist` travels), and replaces the target's `.git/config`, `info/exclude`,
  hooks, `HEAD`, index and `packed-refs` with this machine's. Then one
  `git update-ref` transaction on the target sets every ref to this
  machine's value and deletes the ones this machine doesn't have, loose or
  packed alike, so afterwards the target's refs equal this machine's (a
  target left with a stale loose branch by an older warp is put right by a
  `--force` warp). Saved refs under `refs/hyper-warp-backup/` are kept: the
  copy and the sync leave them alone, and before every plain-repo copy,
  saved refs a `git pack-refs` (or `gc`) moved into `packed-refs` are
  written back as loose refs there. A `--force` warp also saves every
  target stash entry as `refs/hyper-warp-backup/<…>/stash/<n>` (newest is
  0; `git stash apply <ref>` re-applies one) and prints how many; without
  `--force`, stash entries only the target has are refused, each named. A
  target ref that conflicts as file and directory with one here (`df` and
  `df/x`) is refused, naming both; `--force` saves it and deletes it there.
  The target's reflogs are not saved: for refs this machine also has they
  are replaced by this machine's, so a commit there reachable only from a
  reflog is not kept, with or without `--force`.
- **The collision comparison has a 5-minute limit** (about 3,000 files per
  6 s, measured in a container): past roughly 100,000 candidate files warp
  refuses with "couldn't compare".
- **rsync's quick check** skips a file whose size and modification time
  (to the second) match, so a target file backed up as a collision can be
  left in place, unchanged, when only its content differs. The same check
  can skip a plain repo's `.git/index` (same size, same second), so a warp
  can exit 0 and leave the target showing modified files; a `--force` warp
  repairs it.
  Staged-but-uncommitted
  changes arrive as unstaged modifications — the index does not travel.
  The way back is warp from the other machine, which requires this machine
  to be reachable from there (tailnet or a reverse tunnel).
- **A machine on a non-default ssh port** is not reachable as a `host:port`
  target; register it through an ssh config alias instead.
- **The manifest is last-writer-wins by space name** — two machines
  registering the same name at once resolve to whichever push lands last.
  It holds ONE path per space: `hyper space clone` records its clone's path
  when it differs from the recorded one, so `path` is where the space lives
  on the machine that last cloned or initialised it. If that write fails, the
  clone is kept and `hyper space init --refresh` in the space records it.
- **A busy space lock is taken over only when its owner is provably gone**
  (`.hyper/space.git/hyper.lock`): same host and the pid no longer runs, or
  runs with a different start time. A live owner keeps it however long it
  takes. The 30-minute age rule remains only where liveness cannot be judged:
  a lock from another host, from another pid namespace (Linux), from an older
  CLI, or a pid whose start time cannot be read. A lock file hyper cannot
  read or that holds no lock record is never taken over: the command waits,
  then says why. When it gives up, the message names the holder (pid, host,
  how long) and tells you to delete the lock only if that process is gone.
  Two containers sharing a hostname and the space dir but not a pid namespace
  are told apart only on Linux; elsewhere one can misjudge the other's lock.
- **"Backed up" only means pushed.** `session-end` and `manual` cadence
  commit to `.hyper/space.git` on the same disk; the history reaches the
  hyperdrive only through `session-end+push` or `hyper space push`.
- **Session-end saves need the hook or the extension.** Claude sessions are
  saved by the agent plugin's SessionEnd hook and pi sessions by the
  extension in `packages/drive/pi` (see "First machine"); without the
  extension, or with `manual` cadence, save with `hyper space commit`.
- **Incoming `tracked` entries widen what this machine uploads** — that is
  why pull asks instead of adopting them.
- **Drive commands ignore relative PATH entries.** Every `hyper space`,
  `drive`, `warp` and `machine` command keeps only the absolute entries of
  PATH before it runs, so `./bin`, `.` or `./node_modules/.bin` can never
  make it run a space's own `bin/bash` or `bin/git`; a tool reachable only
  through a relative entry is not found. Other `hyper` topics (kits,
  recipes) are not covered by this.
- **Linux logout can cut a session-end save short.** With systemd-logind's
  `KillUserProcesses=yes`, logout kills every process of the login session,
  the detached session-end worker included (`setsid` does not leave the
  session's scope). That save leaves no log line; nothing is lost, because
  the next save commits the same working tree, and a lock it held is taken
  over once its pid is gone. Check with
  `busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager KillUserProcesses`
  (`b true` means it is on), and when it is, run `hyper space commit` before
  logging out of that machine.

## Machine setup

`hyper machine setup <machine>` checks each selected feature, applies unprivileged steps, and prints any remaining root steps as a script for you to read. **Run that script from a root console or a sudo session of your own**; hyper never runs it as root without your explicit choice at the prompt. If a home move is pending, use a root console with the primary user's sessions closed — the move cannot run from that user's own SSH session.

The root script may restart `user@<uid>.service` **only if the primary user's running `systemd --user` manager lacks the new `collab` group**. That restart stops **all of the primary user's user services at once**, including any rootless containers the user runs, so they are down for the moment it takes; enabled units, including the transcript watcher, start again, and containers come back only if a restart policy or a user unit restarts them. A stopped or already-correct manager is left alone, so a second setup is a no-op. If this run installs `docker-ce`, the script also stops and disables the new system-wide Docker daemon; an existing `docker-ce` is reused and its daemon left alone, while any other Docker engine (docker.io, snap, …) makes setup refuse and change nothing.

## Documentation

Full documentation at [hyperdev.saulo.engineer](https://hyperdev.saulo.engineer).

## License

MIT
