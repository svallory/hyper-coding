<!-- fragment, substituted into the other prompts before their own placeholders: {ref} {worktree} {branch} {brief} {gate} {rulings} {forbidden} {forbidden_exclude} ({forbidden} is a list of regular expressions; {forbidden_exclude} is rendered from scan.exclude as " except in files matching <globs>", or empty); the driver strips this line -->
Standing rules for this unit ({ref}):
- Work only in {worktree} (branch {branch}). Never cd; use absolute paths, `git -C`, `env -C`.
- The gate is `{gate}`. Run it in the foreground from the worktree and paste its last lines into your summary. Run only the tests your change affects while you work; the gate is the full check.
- Conventional commits with detailed bodies. No attribution, co-author, session or AI-assisted trailers in commits or the PR.
- Committed files must never mention the space around the repository: notes/, STATUS.md, HYPER.md, scratch/, ../../, sibling worktrees, absolute paths outside the repository, or tracker ids. They must not match any of these regular expressions: {forbidden}{forbidden_exclude}.
- Max 3 attempts on any one thing; then stop with status BLOCKED and the evidence.
- If a design decision is genuinely not settled by the brief ({brief}), the specs, the rulings ({rulings}) or the code, stop with status QUESTION: the question, the options, your recommendation. Do not guess on product or contract decisions.
- Tests: no sleeps; mutation-prove each new behaviour test (break the code, show the failure, restore with `git checkout`).
- Do not run a long command in the background and then end your turn: wait for it in the foreground.
- `rm` only ever takes literal absolute paths: no variables, no globs, no relative paths. Put scratch files in one literal `mktemp -d` directory and remove that directory by its literal path.
