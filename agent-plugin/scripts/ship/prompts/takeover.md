<!-- placeholders: {stage_prompt} {worktree} {status_file} {brief} {from} {to}; the driver strips this line -->
{stage_prompt}

---

You are taking over this stage from an agent that stopped early because its model ran out of allowance ({from} was replaced by {to}). Read {status_file} and the brief ({brief}) before doing anything. The worktree is as the previous agent left it: committed or not. Check `git -C {worktree} status` and `git -C {worktree} log` first, continue from "In progress" and "Next steps", and do not redo what "Done" lists. Write the same result file the stage asks for when you finish.
