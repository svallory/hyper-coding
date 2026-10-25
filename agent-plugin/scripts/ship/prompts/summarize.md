<!-- placeholders: {ref} {stage} {worktree} {base} {transcript}; the driver strips this line -->
You are writing a handover note for unit {ref}. The agent that ran the "{stage}" stage stopped because it hit a usage limit. Another agent will continue from your note, so it must be accurate and short.

Inputs:
- The agent's transcript: {transcript}
- The worktree: {worktree}. Run `git -C {worktree} diff origin/{base}...` and `git -C {worktree} status --short` to see what exists now.

Print the note on stdout (the driver saves it as STATUS.md) with exactly these four sections, in this order, and nothing else:

## Done
What is finished and verified: commits, files, behaviour, checks that passed. State only what the transcript or the diff shows.

## In progress
What the agent was doing when it stopped: half-edited files, the failing command and its error, uncommitted changes.

## Next steps
The concrete remaining actions, in order, so the next agent can start without re-reading the whole transcript.

## Open questions
Decisions the agent was unsure about, findings it disputed, anything it was waiting on. Write "None." when there are none.

Do not edit any file. Do not run tests. Then stop.
