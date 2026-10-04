# hyperdrive for pi

Saves a hyperdrive space when a pi session ends — the same save a Claude Code
session gets from the `SessionEnd` hook, for pi.

## Install

Nothing here is bundled into pi by default. Pick one:

```bash
# 1. for this machine (user extensions):
pi install ~/path/to/hyper/packages/drive/pi

# 2. or load it for one run, without installing:
pi --extension ~/path/to/hyper/packages/drive/pi/hyperdrive.ts
```

`pi install` copies or links the directory into the pi agent dir
(`~/.pi/agent/extensions/`, or `$PI_CODING_AGENT_DIR/extensions/` when that
variable points elsewhere). To load it for one project only, copy the two `.ts`
files into `<project>/.pi/extensions/hyperdrive/`.

A space's own history is saved only when its cadence is `session-end` or
`session-end+push` (`hyper.cadence` in `.hyper/space.git`). With `manual`, or
outside a space, the extension does nothing at all.

## What happens at session end

On pi's `session_shutdown` event (quit, `/new`, `/resume`, `/fork`, `/reload`,
SIGTERM and SIGHUP) the extension does the cheap foreground work and returns
within milliseconds — pi awaits this handler with no timeout:

1. walk up from the session's directory for `.hyper/space.git`;
2. read `hyper.cadence` from that git dir's config file (no `git` process);
3. write the payload to `.hyper/space.git/session-end-payload.*`;
4. start `hyper space commit --session-end --payload-file <file>` **detached**
   (its own session, no inherited pipes) and return.

The detached worker — `packages/drive/src/services/session-end-worker.ts`, the
same one the Claude hook starts — takes the space lock, commits, pushes for
`session-end+push`, and writes one line to `.hyper/space.git/session-end.log`.
A failure shows up in `hyper space status`, never in the session.

The payload is `session_id`, `cwd`, `harness: "pi"` and a `summary`. There is no
`transcript_path`: a pi session file has no `"type":"summary"` records, so
pointing the CLI at it would only stream a session of tens of megabytes for
nothing. The summary is the **session name** when pi has one, otherwise the
**first line of the first prompt** on the active branch — so prompt text lands
in the space's hyperdrive history. The commit subject is `session: <summary>`
and the message ends with `Pi-Session: <session id>`.

The extension never throws into pi, prints at most one line (a missing `hyper`
CLI, or a payload it could not write), and never spawns `git`, `ssh`, `rsync`
or `scp` itself: every space operation goes through the `hyper` CLI.

`hyper machine setup` and `hyper drive sync-config` do **not** install this
extension; whether they should is still open (see the T-18 report).