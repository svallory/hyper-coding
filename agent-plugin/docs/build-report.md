> Moved from the claude-plugins repo on 2026-08-04. Historical record of the original "hyperdev" plugin build; names below predate the rename to "hyper".

# hyperdev — build report and handoff

Written 2026-08-03. Branch `feat/hyperdev-plugin` (pushed; the earlier
`feat/container-plugin` remote branch is the same work under its original name
and can be deleted). Version `0.2.0`. Not yet merged to `main`. On 2026-08-03
the core concept was renamed from "container" to "space"; this doc uses the new
term throughout.

> **Design revision, 2026-08-03 (later the same day): the checkout layout was
> removed.** Real-world use showed it mixes space files (`data/`, `notes/`,
> `scratch/`, `bin/`, `HYPERDEV.md`, gitignore entries) into the project root —
> the exact clutter spaces exist to prevent. A space now has exactly one shape:
> bare `.git` at the root, all checkouts under `worktrees/<branch>`, local-only
> dirs beside them. `/hyperdev:adopt` on an ordinary checkout now **converts**
> it (repo goes bare, the whole working tree moves to `worktrees/<branch>`,
> linked worktrees come in via `git worktree move`, `git status` verified
> before/after, nothing deleted), and `init --layout` is gone. Sections below
> that describe the checkout layout are kept as history and marked
> **superseded** rather than rewritten.

**This doc is written to be handed to someone — or some agent — with no prior
context.** It covers what the plugin is, why each decision was made, and how to
work on it safely. If you are picking this up cold, read in this order:

1. **What it is** and **Layouts** — the model. Nothing else makes sense first.
2. **The design rule** — one rule explains most of the code.
3. **Failure modes actually hit** — the traps, with exact reproductions. This is
   the section that saves you a day.
4. **Working on it** — function contracts, how to verify, how to add a stack.
5. **Known gaps** / **What to do next** — the actual work.

---

## What it is

Two things that turned out to belong together:

1. **Project spaces.** A fixed directory shape per project — the git repo,
   every worktree, and a small set of directories for files that must never be
   committed.
2. **Toolchain integration.** A `PostToolUse` hook that runs the project's *own*
   linter or typechecker after each edit and feeds failures straight back.

The second exists because of [hyperdev.saulo.engineer](https://hyperdev.saulo.engineer).
Of its five principles, **Tools Integration** and **Real-time Feedback** are the
two a Claude Code plugin can actually deliver today. *Deterministic First* and
*Engineered Friction* need generators and complexity scoring; *Reactive Context*
is partly covered by the SessionStart hook. Of the site's `hyper gen` /
`tools` / `plan` / `watch` / `dash` toolkit, `plan` and `gen` now exist at
plugin scale (`/hyperdev:plan`, `/hyperdev:gen`); `watch` and `dash` do not,
and nothing here stubs them.

---

## Layouts

> **Superseded (2026-08-03):** only the bare layout exists now; see the design
> revision note at the top. Kept as written for history.

Both are first-class, because converting between them means re-cloning.

### bare

```
<space>/
├── .git/         bare — no working tree
├── .claude/      settings + memory
├── worktrees/    one worktree per branch
├── data/  notes/  scratch/  bin/
└── HYPERDEV.md
```

The root cannot be committed to. Local-only files get a home that is
*structurally* incapable of reaching the remote.

### checkout

```
<project>/            ordinary working tree, code at the root
├── .git/
├── src/ …            tracked source
├── .claude/worktrees/
├── data/  notes/  scratch/  bin/   ← gitignored
└── HYPERDEV.md
```

The root **is** the repo, so the safety property inverts: local-only dirs are
protected by `.gitignore`, not by construction. A top-level `worktrees/` would
sit inside the working tree, so worktrees live under `.claude/`.

---

## Current surface

| Path | Lines | Purpose |
|---|---|---|
| `scripts/hyperdev-lib.sh` | 349 | layout detection, scaffolding, docs, gitignore |
| `scripts/hyperdev-adopt.sh` | 255 | retrofit onto an existing repo |
| `scripts/hyperdev-check.sh` | 122 | PostToolUse check hook |
| `scripts/hyperdev-init.sh` | 87 | create a new space from a remote |
| `scripts/hyperdev-stack.sh` | 67 | stack dispatcher |
| `scripts/hyperdev-context.sh` | 73 | SessionStart context hook |
| `stacks/node/detect.sh` | 113 | npm / pnpm / yarn / bun + TypeScript |
| `stacks/go/detect.sh` | 42 | go, golangci-lint, Makefile |
| `skills/hyperdev/SKILL.md` | 157 | layout conventions |
| `skills/hyperdev-tooling/SKILL.md` | 101 | toolchain detection rules |
| `commands/{init,adopt,audit,tools}.md` | 300 | four commands |

Registered in `.claude-plugin/marketplace.json`.

---

## The design rule that drove everything

**Report only what is verifiable. Absence means unknown, never a default.**

Three real projects proved why:

| Project | Detected |
|---|---|
| compliance | npm, **no lint script** despite an eslint config, `tsc`, prettier |
| rcl-tree-sitter | bun, every script delegates to `moon`, biome |
| Go fixture | golangci-lint **configured but not installed** |

So detection omits keys it cannot prove. A missing `LINT` means "this project
has no lint script" — not "try `npm run lint`". With no lockfile the package
manager resolves to `unknown` and the hook **declines to run** rather than
defaulting to npm, which would rewrite a bun project's lockfile.

The failure mode this avoids: a check that fails on every edit gets ignored
within a day, and the real failures get ignored with it.

---

## How it was validated

Two clean-room rounds. A subagent with **no context** was given only the goal
and the plugin path, then asked what confused it and what broke.

**Round 1** found:
- `.gitignore` entries duplicated when a path was already covered by
  `.git/info/exclude` → now asks `git check-ignore`
- dead checkouts inside `worktrees/` invisible to the maxdepth-1 scan → now
  listed as ok / orphaned / leftover build output
- "exit 0" was not sufficient verification under a build cache

One round-1 finding was **wrong**: it reported a phantom-pass typecheck caused
by turbo stripping `PROTO_HOME`. It did not reproduce — with `--force` all six
packages ran `tsc` in 5.8s and an injected `TS2322` failed correctly. The
agent's own environment, not the project. Not acted on; the doc weakness it
exposed was real and was fixed.

**Round 2** found:
- adopt suggested filing `pubflow.sqlite` under `data/` while separately warning
  its `-wal`/`-shm` sidecars were live state. The app resolves `PUBFLOW_DB` to a
  **relative** path, so the move would have silently created an empty database.
  Now flagged do-not-move.
- gitignored paths (`test-results`, `.turbo`) suggested for moving, when tooling
  recreates them in place. First fix over-corrected and suppressed every useful
  suggestion; ignore status is now a caution annotation, and specific rules win.
- `write_memory_seed` skipped the index line when present, so an interrupted run
  left a dangling pointer a later run treated as done. Now rewrites.
- No stated command order — both agents independently guessed, and both noted
  `init` does not apply to an existing project.

---

## Failure modes actually hit

Every one of these cost real debugging time. They are written out because the
conclusions in the rest of this doc are cheap to read and expensive to
rediscover.

### 1. Hooks do not inherit your shell

Configuring the check hook against the compliance repo, `npm run
typecheck:server` worked perfectly in a terminal and failed under the hook with:

```
Error: proto::detect::failed
  × Failed to detect an applicable version to run npm with.
```

The `npm` on `PATH` is a **proto shim** that needs environment the hook process
does not have. Same class of failure applies to mise, asdf, nvm, volta.

Had this shipped, the hook would have fired a false failure on **every single
edit** — the exact "trains everyone to ignore it" outcome the whole design rule
exists to prevent.

**Fix:** prefer the project-local binary, which skips version resolution:

```json
{ "check": { "command": "./node_modules/.bin/tsc --build server/tsconfig.json" } }
```

### 2. Relative paths resolve against the config's directory

Follow-on from the above. The hook `cd`s to wherever it found
`.claude/hyperdev.json` before running. In a **bare** space, a config at the
space root has no `node_modules` beside it — the bare repo has no working
tree at all:

```
timeout: failed to run command ‘./node_modules/.bin/tsc’: No such file or directory
```

**Fix:** put the config in the *worktree*, not the space root, whenever the
command uses a relative path. See "Space-level check config" under
Speculative for the proper fix.

### 3. A cache hit is indistinguishable from a real run

`bun run typecheck` on pubflow reported `6 successful, FULL TURBO` in **28ms**
and exited 0. That is a replayed turbo cache, not a typecheck. Exit code alone
cannot tell you the check ran.

**Verify like this instead** — defeat the cache, watch the duration, and prove
it can fail:

```bash
bun run typecheck -- --force      # args after -- reach the underlying tool
bunx turbo run typecheck --force  # or invoke the runner directly
# nx: --skip-nx-cache   gradle: --rerun-tasks   bazel: --nocache_test_results
```

A "passing" typecheck finishing in 30ms did not run `tsc`; cold takes seconds.
Then add a deliberate type error, confirm non-zero exit, and remove it.

### 4. Suggesting a move for a live database

adopt originally suggested filing `pubflow.sqlite` under `data/` while
*separately* warning that its `-wal`/`-shm` sidecars were live state —
contradictory advice on the same three files.

The app resolves `PUBFLOW_DB` to a **relative** `"pubflow.sqlite"`. Moving it
would not have errored; it would have silently created a **fresh empty
database** on next start. Silent data loss from a "tidy up your files" feature.

**Fix:** a `.sqlite`/`.db` with a sidecar present is flagged do-not-move
outright. The general lesson is in the design rule: a heuristic that is usually
right is not good enough when being wrong is unrecoverable.

### 5. Over-correcting a fix until it destroys the signal

The first attempt at "don't suggest moving gitignored paths" checked ignore
status *before* the specific rules. Result: every suggestion collapsed to
`gitignored — leave in place`, including a stray `ghost-theme.zip` and a PDF
that genuinely were movable. The fix removed the feature's entire value.

**Fix:** ignore status is now a caution annotation appended to the suggestion;
the specific rules still win. Worth remembering when fixing a noisy heuristic —
the cure can be worse.

### 6. Detection that matched every repo on the machine

Adding checkout-layout support initially made `space_layout` accept any
non-bare repo root. Suddenly `~/work/claude-plugins` and every other repo
reported as a hyperdev space, and the SessionStart hook fired everywhere.

**Fix:** the checkout layout requires an **opt-in marker** (`HYPERDEV.md` or an
existing `.claude/worktrees/`). The bare layout looked self-identifying at the
time; it has since gained its own gate (`worktrees/` or the marker beside
`.git`), because `core.bare=true` alone also matches mirrors and plain bare
clones. `adopt` deliberately bypasses the gate via `effective_layout`, because
adopt is the thing that *performs* the opt-in.

### 7. A linked worktree claiming to be a space root

`git rev-parse --show-toplevel` returns the worktree's own top, so a linked
worktree satisfied "is the root of a working tree" and stopped the upward walk
before reaching the real space.

Compounding it: in the checkout layout `HYPERDEV.md` is a **tracked file**, so
every worktree carries a copy and the marker check matched too.

**Fix:** `space_layout` requires `.git` to be a *directory* (a linked
worktree has a `.git` **file**), and `is_space` requires both the marker and
a real repo root.

### 8. An interrupted run that looked complete

`write_memory_seed` appended the index line only if absent. An earlier run that
died after writing the index but before the memory file left a dangling pointer
that every later run treated as "already done".

**Fix:** rewrite the line rather than skip it. General shape: *idempotent* is not
the same as *resumable*, and a presence check is the usual way to confuse them.

### 9. A review finding that was simply wrong

A clean-room agent reported that pubflow's typecheck was a phantom pass because
turbo strips `PROTO_HOME`. It did not reproduce: with `--force`, all six
packages ran `tsc` in 5.8s and an injected `TS2322` failed the task correctly.
The agent had broken its own environment and attributed it to the project.

Recorded because the lesson generalises: **a confident, well-written finding is
still a hypothesis.** Reproduce before acting. The doc weakness it exposed
(item 3 above) was real and was fixed; the bug was not.

---

## Working on it

### The library API

> **Partly superseded (2026-08-03):** after the checkout layout's removal,
> `space_layout` prints only `bare`, `effective_layout` and `ensure_gitignored`
> no longer exist, and `worktrees_dir` is always `<root>/worktrees`. The
> current contracts are in `plugins/hyperdev/docs/concepts.md`; the table below
> reflects the two-layout era.

Everything in `scripts/hyperdev-lib.sh` is sourced, never executed. Source it and
call the functions directly — that is also how to test them.

```bash
source plugins/hyperdev/scripts/hyperdev-lib.sh
space_layout /path/to/thing     # prints bare | checkout | nothing
```

| Function | Contract |
|---|---|
| `space_layout <dir>` | prints `bare`/`checkout`, or exits non-zero. **Checkout requires opt-in** (marker or `.claude/worktrees/`). |
| `effective_layout <dir>` | same, but classifies a repo that has *not* opted in. Used by adopt, which performs the opt-in. |
| `worktrees_dir <dir>` | `<root>/worktrees` (bare) or `<root>/.claude/worktrees` (checkout) |
| `is_space <dir>` | marker **plus** a real repo root, or structural detection |
| `find_space_root [dir]` | walks up; skips linked worktrees (`.git` file) |
| `at_space_root` | true when `$PWD` is the root itself |
| `scaffold_dirs <root>` | creates `SPACE_DIRS`, layout-aware; calls `ensure_gitignored` for checkout |
| `ensure_gitignored <root>` | additive; asks `git check-ignore` so it never duplicates an existing rule |
| `write_hyperdev_md <root> <name>` | layout-specific `HYPERDEV.md` |
| `write_memory_seed <root> <name>` | `.claude/memory/hyperdev-layout.md` + index line |

`SPACE_DIRS=(worktrees data notes scratch bin)` is the single source of truth
for the directory set.

**Verified behaviour** (run against real paths on this machine):

| Path | `space_layout` | `is_space` |
|---|---|---|
| a bare space root | `bare` | yes |
| a worktree inside it | — | **no** |
| an adopted checkout root | `checkout` | yes |
| a plain git repo | — | **no** |

Those four rows are the regression suite in miniature. Any change to detection
should keep all four.

### Verifying a change

There is no test runner yet (gap 7), so until there is:

```bash
# 1. syntax — cheap, catches most edits
for f in plugins/hyperdev/scripts/*.sh plugins/hyperdev/stacks/*/detect.sh; do
  bash -n "$f" || echo "FAIL $f"
done

# 2. detection — the four rows above
source plugins/hyperdev/scripts/hyperdev-lib.sh
space_layout <bare-root>; space_layout <checkout-root>
space_layout <plain-repo>   # must print nothing, exit non-zero

# 3. the hooks — pipe real hook JSON, never run the command in a shell
echo '{"tool_input":{"file_path":"/abs/path/to/real.ts"}}' \
  | bash plugins/hyperdev/scripts/hyperdev-check.sh; echo "exit=$?"
cd <space-root> && bash plugins/hyperdev/scripts/hyperdev-context.sh

# 4. adopt — always dry-run first; it prints what it would do
bash plugins/hyperdev/scripts/hyperdev-adopt.sh <path>
```

For anything touching adopt's suggestions, run it against a **messy real repo**,
not a fixture. Both rounds of genuine bugs came from real projects with live
databases, build caches, and stray files — never from a clean fixture.

### Adding a stack

Deliberately mechanical. Create `stacks/<name>/detect.sh` defining two functions;
the dispatcher discovers it by directory scan, so **no existing file changes**.

```bash
stack_matches() { [[ -f "$1/Cargo.toml" ]]; }   # exit 0 when this stack applies

stack_detect() {                                 # print KEY=VALUE, omit unknowns
  local d="$1"
  echo "STACK=rust"
  echo "PM=cargo"
  # ... only what you can actually verify in $d
}
```

Honour the design rule: emit a key only when you can prove it. A missing `LINT`
means "no lint entry point exists", which is an answer. Guessing one is not.

Test with:

```bash
bash plugins/hyperdev/scripts/hyperdev-stack.sh list
bash plugins/hyperdev/scripts/hyperdev-stack.sh detect <project>
```

---

## Known gaps

### Real limitations

1. **`init` only creates bare spaces.** `hyperdev-init.sh` has no notion of
   the checkout layout — it always bare-clones. Adopting an existing checkout
   works; creating one does not. *(resolved 2026-08-03: `init` now takes
   `--layout bare|checkout`.)*
2. **`audit` has no script.** It is a markdown checklist that wraps the adopt dry
   run plus judgement checks. The command list implies parity with the other
   three that does not exist. Either write the mechanical half or keep saying so
   plainly. *(resolved 2026-08-03: `hyperdev-audit.sh` does the mechanical half;
   the judgement calls stay in the command markdown.)*
3. **Nothing ever deletes.** Orphaned worktrees, stale branches, and an oversized
   `scratch/` are reported for a human to act on. Defensible, but it means the
   plugin can detect debris it will not clear.
4. **The check hook runs one command.** No lint-and-typecheck, no per-language
   routing in a polyglot repo, no incremental "only the edited file" mode. On a
   large codebase a full typecheck per edit is too slow, and the only lever is
   `extensions` plus `timeout`. *(partly resolved 2026-08-03: a `checks` array
   runs several commands, each with its own extension filter and timeout;
   incremental per-file mode still absent.)*
5. **Monorepo blind spot.** A package with no `typecheck` script is silently
   skipped: the hook fires, the command runs, it passes, and the edited file was
   never inspected. Documented in `tools.md`; not detected automatically.
   *(resolved 2026-08-03 as documentation — automatic detection remains open.)*
6. **`command` executes arbitrary code from a repo file.** An untrusted checkout
   runs it on first edit. Documented rather than sandboxed.

### Missing infrastructure

7. **No tests.** Not one. Every fix in this report was verified by hand against
   real repos and throwaway fixtures. Bash is testable — `bats` or even a plain
   script over fixture directories would pin layout detection, the gitignore
   dedup, and the adopt suggestion matrix.
8. **No CI.** Nothing runs `bash -n`, let alone shellcheck.
9. **No README.** `REPORT.md` (this file) and the two skills are the only prose.
   *(resolved 2026-08-03: `plugins/hyperdev/README.md` covers the layouts, the
   commands, and install.)*

---

## What to do next, roughly in order

### High value, low effort

- **Tests over fixture repos.** The highest-value gap, and the best first task.
  `bats` if you want a runner, plain bash if you do not — the library is sourceable
  so either works.

  Build fixtures with `git init` + `mkdir`, no network needed:

  | Fixture | Must yield |
  |---|---|
  | bare repo + `worktrees/` | `bare`, is_space yes |
  | checkout + `HYPERDEV.md` | `checkout`, is_space yes |
  | checkout, no marker | nothing, is_space **no** (the opt-in gate) |
  | linked worktree | nothing, and `find_space_root` reaches the real root |
  | repo with `/data/` in `.git/info/exclude` | `ensure_gitignored` adds nothing |

  Also worth pinning: adopt's suggestion matrix (a `.sqlite` with sidecars → do
  not move; `node_modules` → tool-managed; a stray `.zip` → `data/`), and
  `write_memory_seed` idempotency across three consecutive runs.

  *Done when:* the five rows pass, and reverting any single fix from "Failure
  modes actually hit" turns a test red.

- **shellcheck + `bash -n` in CI.** No `.github/workflows/` exists in this repo at
  all, so this is a from-scratch workflow file. All six scripts are strict-mode;
  shellcheck will find quoting bugs the hand testing did not.

- **A README** covering the two layouts, the four commands, and install. Right now
  a user must read `SKILL.md` to learn what the plugin even is. Most of the prose
  can be lifted from this doc's first two sections. *(resolved 2026-08-03:
  `plugins/hyperdev/README.md`.)*

- **Make `audit` real.** Currently markdown-only, which the command list implies
  otherwise. The mechanical half is well understood from running it by hand:

  - worktree entries: ok / orphaned (gitdir missing) / leftover build output —
    `hyperdev-adopt.sh` already implements exactly this; extract it
  - branches gone from the remote: `git branch -vv | grep ': gone]'`
  - dirty worktrees: `git -C <wt> status --short` per worktree
  - `du -sh scratch/`, and loose files over ~10MB at the root
  - secret-looking names at the root (`.env`, `*.pem`, `id_rsa`, credential JSON)
    — **report the path only, never contents**

  Keep the judgement calls in the markdown. The script should print findings and
  change nothing. *(resolved 2026-08-03: `hyperdev-audit.sh`, exactly this
  shape.)*

### Medium

- **`init` for checkout spaces.** `git clone` + scaffold + gitignore, sharing
  `scaffold_dirs`/`ensure_gitignored` with adopt. Mostly plumbing.
  *(resolved 2026-08-03: `--layout checkout`.)*
- **More stacks.** Adding one means a `stacks/<name>/detect.sh` with
  `stack_matches` + `stack_detect` — no dispatcher edit. Rust (`Cargo.toml`),
  Python (`pyproject.toml`, and the uv/poetry/pip split), Deno, Elixir.
  *(partly resolved 2026-08-03: Rust and Python landed; Deno and Elixir did not.)*
- **Multi-command checks.** `"checks": [{run, extensions, timeout}, …]` so lint
  and typecheck can both fire on the files each cares about.
  *(resolved 2026-08-03: exactly this shape, in `hyperdev-check.sh`.)*
- **Detect the monorepo coverage hole.** Compare packages the check command
  touches against the workspace list; warn when a package has no script.
- **A cleanup command** (`/hyperdev:prune`) for the debris audit reports —
  explicit, confirmed, never automatic.

### Speculative

- **Per-file checks.** `tsc --noEmit <file>` is wrong for a project with path
  aliases, but `eslint <file>` is exactly right and much faster. Worth routing
  per tool.
- **A `worktrunk` bridge.** The checkout layout does not match the user-level
  `worktree-path` template (`{{ repo_path }}/../worktrees/…`), so `wt switch`
  places new worktrees outside `.claude/worktrees/`. Either generate a
  project-level `.config/wt.toml` during adopt, or document the mismatch harder
  than the current one paragraph in `SKILL.md`.
- **Space-level check config.** Today the config must live in the worktree
  because relative paths resolve against it. A space-level default that each
  worktree inherits — with paths resolved against the *edited file's* worktree —
  would remove the duplication.

---

## Notes for whoever picks this up

### Environment

- **Never edit `~/.claude/plugins/marketplaces/svallory-plugins`.** It
  auto-updates and will discard uncommitted work. Develop in
  `~/work/claude-plugins`, commit, push.
- Adding a plugin needs **both** `plugins/<name>/` and an entry in
  `.claude-plugin/marketplace.json`. It is invisible without the second.
- Test hook changes by piping hook JSON into the script, not by running the
  command in a shell — only that exercises the real environment:

  ```bash
  echo '{"tool_input":{"file_path":"/abs/path/to/real.ts"}}' \
    | bash plugins/hyperdev/scripts/hyperdev-check.sh; echo "exit=$?"
  ```

  Exit 0 on a clean file, exit 2 on one with a deliberate error. If it cannot
  fail, it is not a check.

### Re-run the clean-room test after any substantial change

This is the process that found every real bug, twice, and it is cheap. Give a
subagent with **no context** only the goal and the plugin path:

> Get the project at `<path>` into shape using the `hyperdev` plugin at
> `<plugin path>`. Read the commands and skills and follow them. Do not modify
> the plugin — if something is broken, confusing, or leads you astray, record it
> rather than fixing it. Report what you ran, what confused you, where the docs
> disagreed with actual behaviour, and whether the check hook you configured can
> actually **fail** — prove it, don't assume exit 0 means it works.

Point it at a **messy real project**, not a fixture. Every genuine finding came
from real repos with live databases, build caches, and stray files.

Then treat its report as a hypothesis, not a verdict — see failure mode 9. Both
rounds produced at least one confident finding that was wrong, and acting on
those would have made the plugin worse.

### Judgement calls worth preserving

If you are tempted to "simplify" one of these, this is why it is the way it is:

- **Detection omits keys it cannot verify.** Never add a fallback default. A
  wrong check command is worse than no check command.
- **Nothing deletes.** adopt and audit report; a human acts. The one time the
  tool nearly moved something on its own it would have destroyed a database.
- **Both layouts are gated.** Checkout needs the opt-in marker because every
  git repo looks like a checkout; bare needs `worktrees/` or the marker beside
  its `.git`, because `core.bare=true` alone also matches mirrors and hosting
  remotes.
- **`swallow` in the check hook is deliberate** — a failing *check* must not
  break a user's edit loop. But it means silent gaps, which is why the
  verification recipe insists you prove the check can fail.

### Scope note

The plugin is at `0.2.0` and has never been used by anyone but its author, on
three projects (`compliance`, `pubflow`, `rcl-tree-sitter`). Treat the
conventions as validated, and the edge cases as merely unrefuted.
