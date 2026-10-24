<!-- placeholders: {ref} {pr} {round} {worktree} {base} {verify_instructions} {verdict_file}; the driver strips this line -->
Verify unit {ref} at runtime. Do not call the Skill tool for this: do the procedure by hand. The diff is `git -C {worktree} diff origin/{base}...HEAD` (PR #{pr}, round {round}).

Project verify instructions:

{verify_instructions}

General rules: drive the changed code through its real surface, not through the test suite. Check exit codes and stderr as well as the output; a failure path that exits 0 is a FAIL. Exercise at least one failure path. Keep it cheap: the smallest path that executes the change plus one or two probes. Do not run tests, do not edit code. `rm` only ever takes literal absolute paths (no variables, globs or relative paths); use a fresh literal `mktemp -d` directory per run. If the change has no runtime surface yet, the verdict is SKIP with the reason.

When finished, write your result as JSON to {verdict_file} using the Write tool, shaped like:

{"verdict":"PASS|FAIL|BLOCKED|SKIP","summary":"<steps taken and what was observed>","failures":[{"what":"<what failed, or the command and file>","evidence":"<what was done and observed>"}]}

Leave "failures" empty unless the verdict is FAIL. That file is how the lead receives your result; nothing else is read. Then stop.
