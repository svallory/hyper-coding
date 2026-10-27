# Affected-only test runs

Reference for the `test-engineer` skill. The goal: one command, checked into
the project, that runs the tests a change affects and nothing else, from a
base ref. Its consumers are the brief's `## Tests` section (the dev's working
loop) and, when the project chooses, the ship `gate`.

- [The contract](#the-contract)
- [Selection per stack](#selection-per-stack)
- [A path map for harnesses without a dependency graph](#a-path-map-for-harnesses-without-a-dependency-graph)
- [Lanes and CI](#lanes-and-ci)
- [Checks](#checks)

## The contract

`<project test:affected command> [base]`:

1. takes a base ref (default `origin/<base branch>`), lists the files changed
   between the merge base and the working tree, uncommitted changes included:
   `git diff --name-only "$(git merge-base "$base" HEAD)"` plus
   `git ls-files --others --exclude-standard`;
2. maps those files to test files or targets, through the stack's dependency
   graph or a path map;
3. widens to everything when a file every test depends on changed (shared
   helpers, the test config, the lockfile, CI config); never narrows by hand;
4. runs them, prints what it selected and why, and exits with the runner's
   code; with nothing selected it prints `affected: nothing selected` and
   exits 0;
5. finishes under the project's affected budget (60 s by default) on an idle
   machine. If it cannot, the suite has a layer problem (`audit.md`), not a
   selection problem.

The dev reports: the command, the files and tests it ran, and the wall time.
"All tests pass" is not a claim an affected run supports; "affected tests
pass (N files, M tests, T s)" is.

## Selection per stack

| Stack | Mechanism | Notes |
|---|---|---|
| vitest | `files=$(<the contract's changed-file list, filtered to '*.ts' '*.tsx' '*.js'>); [ -n "$files" ] && bunx vitest related $files --run` (uncommitted changes included, empty list guarded: `vitest related` with no files runs nothing useful) | static import graph; dynamic `import()` edges are missed, so a module loaded dynamically needs a path-map entry. `vitest --changed origin/main` does the git part itself, uncommitted changes included |
| jest | `jest --findRelatedTests <files>` or `jest --changedSince=origin/main` | static graph, same caveat |
| bun test | `bun test <test files or directories>` from a path map | no graph; map or run the package |
| pytest | `pytest --testmon` (coverage-based, keeps `.testmondata`); else `pytest <touched test files>` plus a path map | testmon selects by executed lines, so it sees dynamic imports |
| Go | map changed files to packages (`go list -f '{{.ImportPath}}' ./<dir>`), then keep every package whose `go list -f '{{.ImportPath}} {{join .Deps " "}} {{join .TestImports " "}} {{join .XTestImports " "}}' ./...` line names a changed package, and `go test` those | `.Deps` excludes test-only imports, hence the `TestImports` fields. `go test` also caches unchanged packages, so a full `go test ./...` on a warm cache often is affected-only already |
| Rust | no built-in selection: `cargo test -p <changed crates>` plus their reverse dependencies from `cargo tree -i -p <crate> --workspace` (one line per dependent) | `cargo nextest` runs the same set faster, in parallel per test |
| Bazel | `bazel test $(bazel query "tests(rdeps(//..., set(<changed labels>)))")` | exact, when the build graph is complete |
| moon / nx / turbo | `moon run :test --affected`, `nx affected -t test --base=origin/main`, `turbo run test --filter=...[origin/main]` | project-level granularity; pair with the stack's file-level selector inside the project |
| bash harnesses (bats, hand-rolled `test-*.sh`) | a path map, below | no graph exists; the map is the graph |

When a project has none of these wired, the first unit of the plan adds the
`test:affected` script (consumers: every later unit's brief and the dev
loop); the other units depend on it.

## A path map for harnesses without a dependency graph

A map from source path patterns to test files, kept beside the tests, read
by one script. Rules in the map are the dependency graph the harness lacks;
a rule that is missing is found by a review check ("reachable by affected
selection") or by a test failing in CI that the affected run skipped, and is
added then.

```
# tests/affected.tsv — <glob of changed path> <space> <test files or ALL>
scripts/ship/ship-land            tests/test-t-ship-land.sh
scripts/ship/ship-loop            tests/test-t-ship-loop.sh tests/test-t-ship-unit-driver.sh
scripts/ship/prompts/*            tests/test-t-ship-loop.sh
scripts/ship/lib.sh               ALL
tests/helpers.sh                  ALL
tests/test-*.sh                   SELF
skills/*/SKILL.md                 tests/test-s-ship-skills.sh tests/test-u-skill-triggers.sh
docs/*                            tests/test-w-ship-docs.sh
```

```bash
#!/usr/bin/env bash
# tests/affected.sh [base] — run the test files the change affects (path map above).
# Needs bash 4+ for the associative array (macOS ships 3.2: use Homebrew bash, or
# collect the selection in a sorted temp file instead).
set -euo pipefail
base="${1:-origin/main}"; here="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"; root="$(cd "$here/.." && pwd)"
changed="$( { git -C "$root" diff --name-only "$(git -C "$root" merge-base "$base" HEAD)"; git -C "$root" ls-files --others --exclude-standard; } | sort -u)"
[[ -n "$changed" ]] || { echo "affected: nothing changed"; exit 0; }
declare -A sel=(); all=0
while read -r pat targets; do
  [[ -n "$pat" && "$pat" != \#* ]] || continue
  while IFS= read -r f; do
    # shellcheck disable=SC2053  # the map's pattern is meant to glob-match
    [[ "$f" == $pat ]] || continue
    case "$targets" in
      ALL) all=1 ;;
      SELF) sel["$root/$f"]=1 ;;
      *) for t in $targets; do sel["$root/$t"]=1; done ;;
    esac
  done <<<"$changed"
done <"$here/affected.tsv"
if [[ $all == 1 ]]; then echo "affected: shared file changed, running everything"; exec bash "$here/run.sh"; fi
[[ ${#sel[@]} -gt 0 ]] || { echo "affected: nothing selected"; exit 0; }
printf 'affected: %s\n' "${!sel[@]}"
rc=0; for t in "${!sel[@]}"; do bash "$t" || rc=1; done; exit $rc
```

Wire it as the project's `test:affected` command (a `package.json` script, a
`Makefile` target, or the name in the rules file), and name it in every
brief's `## Tests` section.

## Lanes and CI

- **Affected run**: the dev loop and, by choice, the ship `gate`. Small and
  medium tests only.
- **Full suite**: CI on the PR, sharded across jobs (`vitest --shard=i/n`,
  `jest --shard=i/n`, `pytest-split`) and parallel within a job
  (`pytest-xdist`, `bats --jobs`) so wall time stays under the suite budget
  (10 min default). CI enforces the budget: a job timeout at the
  budget, and a duration report (`vitest --reporter=verbose`,
  `pytest --durations=20`, timing lines in a bash harness) so growth is
  visible in the PR.
- **Slow lane**: large tests, contract tests against real services,
  full-count property runs. A separate runner project, marker or directory,
  run in CI and on a schedule, never in the affected run. Anything that joins
  the slow lane names the journey it covers.
- **Quarantine lane**: flaky tests, with owner and date, excluded from the
  gate, reviewed weekly; a test older than a week there is fixed or deleted.

The ship `gate` then reads, for a project with these lanes:

```yaml
gate: "bun run test:affected origin/main"     # the full suite runs in CI on the PR
```

A project that keeps the full suite as its gate accepts that every unit pays
the suite's wall time twice (finalize and land); set the suite budget and
enforce it in CI, or the gate becomes the longest step of every unit.

## Checks

The setup is done when:

1. `test:affected` with a change to one leaf source file runs only that
   file's tests and says so;
2. a change to a shared helper widens to everything and says so;
3. a new test file placed by the project's conventions is selected without
   editing the map (graph-based stacks) or the map has a `SELF`/glob rule
   for it (path-map stacks);
4. with no change it exits 0 with `nothing selected`;
5. the command is named in the project's rules file and the brief template's
   `## Tests` section points at it.
