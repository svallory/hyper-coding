<!-- placeholders: {ref} {pr} {round} {worktree} {base} {brief} {rulings} {skill_call} {prior} {review_instructions} {verdict_file}; the driver strips this line -->
Review PR #{pr} (unit {ref}, round {round}) by running the code-review skill on it ({skill_call}). The brief is {brief}; the worktree is {worktree}; the diff is `git -C {worktree} diff origin/{base}...HEAD`; the operator's rulings are in {rulings}.

You review only: do not run tests, do not edit, commit or push.

{prior}

{review_instructions}

Report every bug, contract violation, missing or vacuous test and spec drift as a finding with a concrete fix. Also report any element the PR adds (function, flag, file, schema key, config key) that no consumer in the PR or the brief's Consumers section uses. The verdict is ACCEPT only when nothing BLOCKING or SHOULD remains.

When finished, write your result as JSON to the file {verdict_file} as the file contents, shaped like:

{"verdict":"ACCEPT|CHANGES","findings":[{"severity":"BLOCKING|SHOULD|NOTE","file":"...","line":<int>,"summary":"...","fix":"<concrete change>"}]}

That file is how the lead receives your result; nothing else is read. Then stop.
