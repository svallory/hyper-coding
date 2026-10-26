<!-- placeholders: {ref} {stage} {worktree} {base} {transcript} {diff_file} {git_file}; the driver strips this line -->
You are writing a handover note for unit {ref}. The agent that ran the "{stage}" stage stopped before finishing. Another agent will continue from your note, so it must be accurate and short.

Inputs (read them with the Read tool; you have no other tool):
- The agent's transcript: {transcript}
- The changes in the worktree {worktree} against origin/{base}: {diff_file}
- Commits and uncommitted files: {git_file}

Print the note on stdout (the driver saves it as STATUS.md) with exactly these four sections, in this order, and nothing else:

## Done
What is finished and verified: commits, files, behaviour, checks that passed. State only what the transcript or the diff shows.

## In progress
What the agent was doing when it stopped: half-edited files, the failing command and its error, uncommitted changes.

## Next steps
The concrete remaining actions, in order, so the next agent can start without re-reading the whole transcript.

## Open questions
Decisions the agent was unsure about, findings it disputed, anything it was waiting on. Write "None." when there are none.

Do not quote error messages from the provider or the harness about quotas or allowances; the note is read by an automated check that treats such wording as a fault. Do not edit any file. Then stop.
