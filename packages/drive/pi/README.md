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
pi install /path/to/packages/drive/pi

# 2. or load it for one run, without installing anything:
pi -e /path/to/packages/drive/pi            # the directory
pi -e /path/to/packages/drive/pi/hyperdrive.ts   # the single entry file
```

`package.json` here declares `pi.extensions: ["./hyperdrive.ts"]`, so the
directory loads exactly one extension — `session-end.ts` is its import, not a
second extension, and `pi-api.d.ts` is a type declaration.

From the npm package the directory is `node_modules/@hypercli/drive/pi`:

```bash
pi install ./node_modules/@hypercli/drive/pi
```

For one project only, copy `package.json`, `hyperdrive.ts` and `session-end.ts`
into `<project>/.pi/extensions/hyperdrive/`. Pi only loads a project extension
after the project is trusted, so that directory does nothing until you grant
trust for the project.

A space's own history is saved only when its cadence is `session-end` or
`session-end+push` (`hyper.cadence` in `.hyper/space.git`). With `manual`, or
outside a space, the extension does nothing at all.

## What happens at session end

On pi's `session_shutdown` event with reason `quit` — `/new`, `/resume`,
`/fork` and `/reload` are session replacement and save nothing, and a SIGTERM
or SIGHUP shutdown emits the same `quit` — the extension does this and returns
within milliseconds; pi awaits this handler with no timeout:

1. resolve `hyper` itself: absolute PATH entries only, an executable regular
   file, and that absolute path is what gets spawned (`bin/` is synced space
   content, so a space must not choose what runs at its sessions' end);
2. run `hyper space detect --json` once, in the session's directory, killed
   after 2 s. Its answer — root, git dir, cadence — is the only source of
   truth for "is this a space" and "when does it save";
3. write the payload to the git dir the CLI named, as
   `.hyper/space.git/session-end-payload.*`;
4. start `hyper space commit --session-end --payload-file <file>` **detached**
   (its own session, no inherited pipes) from the session's directory, and
   return.

A CLI too old to answer prints one line naming `@hypercli/cli` and saves
nothing. A CLI that does not answer within the bound saves nothing, silently.

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
`hyper space status` then reports as a failed session end. The commit subject is `session: <summary>`
and the message ends with `Pi-Session: <session id>`.

The extension never throws into pi, prints at most one line (a missing `hyper`
CLI, or a payload it could not write), and never spawns `git`, `ssh`, `rsync`
or `scp` itself: every space operation goes through the `hyper` CLI.

`hyper machine setup` and `hyper drive sync-config` do **not** install this
extension; whether they should is still open (see the T-18 report).