# hyperdrive for pi

Saves a hyperdrive space when a pi session ends — the same save a Claude Code
session gets from the `SessionEnd` hook, for pi.

## Install

Verified with pi 1.0.2. Pi's own words: a local path is "loaded from the
resolved path without copying", and a file path loads one extension while a
directory "follows normal package discovery rules".

```bash
# 1. for this machine. Writes the resolved path into ~/.pi/agent/settings.json
#    under "packages" (or .pi/settings.json with --local); nothing is copied.
#    Give it an ABSOLUTE path, or one relative to the settings file it lands in.
pi install "$PWD/packages/drive/pi"

# 2. or load it for one run, without installing anything:
pi -e "$PWD/packages/drive/pi"                  # the directory
pi -e "$PWD/packages/drive/pi/hyperdrive.ts"    # the single entry file
```

`package.json` here declares `pi.extensions: ["./hyperdrive.ts"]`, so the
directory loads exactly one extension — `session-end.ts` is its import, not a
second extension, and `pi-api.d.ts` is a type declaration.

From the npm package the directory is `node_modules/@hypercli/drive/pi`:

```bash
pi install "$(pwd)/node_modules/@hypercli/drive/pi"
```

For one project only, copy `package.json`, `hyperdrive.ts` and `session-end.ts`
into `<project>/.pi/extensions/hyperdrive/`. Pi only loads a project extension
after the project is trusted, so that directory does nothing until you grant
trust for the project.

A space's own history is saved only when its cadence is `session-end` or
`session-end+push` (`hyper.cadence` in `.hyper/space.git`).

## What happens at session end, and what it costs

On pi's `session_shutdown` event with reason `quit` — `/new`, `/resume`,
`/fork` and `/reload` are session replacement and save nothing, and a SIGTERM
or SIGHUP shutdown emits the same `quit` — the extension does this. pi awaits
this handler with no timeout, so every step is bounded:

1. resolve `hyper` itself: absolute PATH entries only, an executable regular
   file, and that absolute path is what gets spawned (`bin/` is synced space
   content, so a space must not choose what runs at its sessions' end);
2. run `hyper space detect --json` once, in the session's directory, killed
   after 5 s. Its answer — root, git dir, cadence — is the only source of
   truth for "is this a space" and "when does it save";
3. write the payload to the git dir the CLI named, as
   `.hyper/space.git/session-end-payload.*`;
4. start `hyper space commit --session-end --payload-file <file>` **detached**
   (its own session, no inherited pipes) from the session's directory, and
   return.

**Measured**: one quit in a space took 392 ms and one outside a space 198 ms
on the author's machine, all of it the probe; a review measured 200 to 700 ms,
and a cold CLI start alone 0.95 s (over 2 s under load). The bound is 5 s, and
hitting it saves nothing. It is not silent, though: the extension walks up from
the session's directory to the nearest REAL space git dir — `.hyper` and
`.hyper/space.git` both real directories (checked with `lstat`, so a symlink at
either level is skipped) holding `HEAD` and `config` as regular files — and
appends one `failed` line, `probe timed out (…)`, to its `session-end.log` in
the worker's own format, so `hyper space status` shows the save that did not
happen. The log is opened `O_NOFOLLOW`, and one that exists but is not a
regular file is left alone. A `.hyper/space.git` folder without `HEAD` and
`config` (debris inside a clone) is skipped and the walk goes on up. With no
such directory above the session, nothing is written anywhere. A `manual`
space gets the line too: without the CLI's answer the extension never learnt
the cadence, and the line says so. It prints nothing and starts nothing. With `manual`, or outside a space, the probe still
runs (that is how the extension knows) and nothing is saved.

### Every line it can print

At most one, and only in these four cases:

| Line | When |
|---|---|
| `hyperdrive: the hyper CLI is not installed; nothing was saved` | no `hyper` on an absolute PATH entry **and** an ancestor of the session's directory holds `.hyper/space.git` |
| `hyperdrive: the installed hyper CLI is too old for this pi extension …; update @hypercli/cli` | the CLI answered with an object that has a root and no `spaceGitDir` field at all — a CLI from before T-18. Its own text, not the Claude hook's. |
| `hyperdrive: could not write the session-end payload into <git dir>; nothing was saved` | the space's git dir would not take the payload |
| `hyperdrive: the hyper CLI is not installed; nothing was saved` (from the worker spawn) | the resolved binary disappeared between the probe and the spawn |

Everything else is silent: no space, an uninitialised space, `manual`, a CLI
that fails, prints garbage, or overruns the bound (that last one is logged, as
above, but not printed). A CLI so old that `space detect` has no `--json` flag
prints nothing on stdout, so it is silent too: it does not get the outdated-CLI
line, which needs a JSON answer with a root and no `spaceGitDir` field.

The detached worker — `packages/drive/src/services/session-end-worker.ts`, the
same one the Claude hook starts — takes the space lock, commits, pushes for
`session-end+push`, and writes one line to `.hyper/space.git/session-end.log`.
A failure shows up in `hyper space status`, never in the session.

The payload is `session_id`, `cwd`, `harness: "pi"` and a `summary`. There is no
`transcript_path`: a pi session file has no `"type":"summary"` records, so
pointing the CLI at it would only stream a session of tens of megabytes for
nothing. The summary is the **session name** when pi has one, otherwise the
**first line of the first prompt** on the active branch — so prompt text lands
in the space's hyperdrive history.

A session started with a custom `pi --session-id` that is not a UUID cannot be
recorded: the CLI requires a UUID `session_id` and refuses the payload, which
`hyper space status` then reports as a failed session end. The commit subject
is `session: <summary>` and the message ends with `Pi-Session: <session id>`.

The extension never throws into pi, prints at most one line (one of the table
above), writes nothing in a space but the payload or the timed-out line, and
never spawns `git`, `ssh`, `rsync`
or `scp` itself: every space operation goes through the `hyper` CLI.

`hyper machine setup` and `hyper drive sync-config` do **not** install this
extension; whether they should is still open (see the T-18 report).