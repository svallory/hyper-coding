# Layers, doubles, seams, determinism

Reference for the `test-engineer` skill. Read the section you need.

- [Test sizes](#test-sizes)
- [Doubles: real, fake, stub, mock](#doubles-real-fake-stub-mock)
- [Seams and the functional core](#seams-and-the-functional-core)
- [Determinism](#determinism)
- [Fixtures and builders](#fixtures-and-builders)
- [When a technique pays](#when-a-technique-pays)
- [Stack examples](#stack-examples)

## Test sizes

Sizes are defined by what a test may touch, not by what it is called. The
size decides the budget and the lane.

| Size | May use | May not use | Budget | Lane |
|---|---|---|---|---|
| **small** | one process, one thread, memory, a hermetic in-memory or temp file system | sleep, the real clock, network, other processes, a database, a browser | 100 ms per case, 2 s per file | always, and in the affected run |
| **medium** | several processes or threads, a temp directory, localhost (a stub binary on PATH, an in-memory or local store, a loopback server) | anything off this machine, the real clock, sleeps | 2 s per case | affected run when its package or fixture changed |
| **large** | the real surface: the built program, several machines, a browser, a real service behind a contract | per-edge-case use | seconds to minutes | slow lane: CI and the pre-merge gate, never the working loop |

Rules of thumb that follow:

- "Integration" in the testing-trophy sense (several modules in one process,
  no network) is still **small**. Spawning the program is not.
- A higher-level test that catches a bug no lower-level test catches is a
  signal to write the lower-level test, then decide whether the higher one
  still earns its lane.
- A proportion to expect in a healthy suite: most cases small, a tenth or so
  medium, a handful large, one per journey. A suite that inverts this is the
  one that takes twenty minutes.

## Doubles: real, fake, stub, mock

Prefer, in order:

1. **The real thing**, when it is fast, deterministic and cheap to build
   (value objects, pure modules, an in-memory collection).
2. **A fake**: a working, simplified implementation (in-memory store, a stub
   `gh` binary that answers from a fixture file, a temp git repository). Owned
   with the real interface, checked against it by a contract test that runs on
   a schedule. A fake fails loudly on anything it does not implement.
3. **A stub**: canned answers for one or two calls. Cannot hold state; drifts
   from the real contract. Use for the read side of a boundary in one test.
4. **A mock** (interaction verification): only when the call *is* the
   behaviour: a write, a send, a delete, or a count that is the point ("the
   cache made one read, not three"). Never verify reads. Never assert on
   arguments the behaviour does not depend on.

Do not mock what you do not own: wrap the third-party API in an adapter you
own, fake the adapter, and give the adapter one medium test against the real
thing in the slow lane.

A test whose setup is more than half mock configuration is at the wrong layer:
either the code needs a seam, or the test should be a medium test against a
fake.

## Seams and the functional core

A seam is a place where behaviour can be changed without editing the code
that has it. Tests need seams to reach behaviour in-process.

| Seam | How | Example |
|---|---|---|
| Parameter | pass the collaborator in (clock, store, runner, `env`) | `land(opts, {gh, git, now})` |
| Sourceable script | put the logic in functions; run `main` only when executed | bash `[[ "${BASH_SOURCE[0]}" == "$0" ]] && main "$@"` |
| Pure core, I/O shell | decisions as pure functions over values; one thin shell does the I/O and calls them | `decideLand(prState, headSha) -> {action, reason}`; the shell runs `gh` and `git` |
| Binary on PATH | the program calls tools by name; tests prepend a directory with stubs | a `gh` stub that reads `GH_STATE=merged` |
| Environment knob | a documented variable the shell reads | `SHIP_POLL_S=0` |

The **functional core / imperative shell** split is the single highest-return
change for a slow suite: every decision becomes a small test with literal
inputs; the shell gets one medium test per command proving it wires the
decisions to the real tools. A script that today can only be tested by
running it has no core yet; adding one is part of the unit that needs it, not
a later cleanup.

## Determinism

| Source of flakes | Rule |
|---|---|
| Time | inject the clock; fake timers in the test runner; fail a lint on direct clock calls in the core |
| Sleeps and polling | wait on an event, a promise, a file appearing, with a timeout as backstop; never `sleep N` and hope |
| Randomness | seed it from the test and print the seed on failure |
| Order and shared state | each case owns its state inside the fixture; the fixture resets between cases; run the file shuffled once to prove it |
| Resource leaks | pool of size one in tests, so the first leak fails the first victim, not a later test |
| Network, remote services | a fake plus one scheduled contract test; nothing off-machine in the affected run |
| Parallel workers | no fixed ports, no fixed temp paths, no shared files; `mktemp -d` per file |

Quarantine, not retries: a test that fails without a code change is moved
to a quarantine lane the same day, with an owner and a date, and leaves the
lane fixed or deleted within a week. Automatic reruns hide the cause and
pay for it on every run.

## Fixtures and builders

- One expensive fixture per file (or per suite): a repository, a server, a
  database, a built binary. Cases change state inside it and leave it as they
  found it (a new branch, a transaction rolled back, a row removed).
- Builders over literals for structured input: `aPr({state: "MERGED"})`
  returns a full valid object; the test names only the fields the behaviour
  depends on. A builder lives in the test helpers and has one consumer per
  field it defaults.
- Fixture data is complete and real-shaped. A partial object that works only
  because the code never looks at the rest is a mirror of the implementation.
- Test code is DAMP, not DRY: repetition that keeps a test readable in
  isolation is fine; shared logic that hides what a test does is not.
- Tables (parametrised cases) for variants of one behaviour: one row per
  input, literal expected values, failure message naming the row.

## When a technique pays

| Technique | Use when | Do not use when | Cost control |
|---|---|---|---|
| **Property-based** (fast-check, Hypothesis, proptest) | an invariant is cheaper to state than examples: round trip (parse then print), idempotence (format twice), commutativity of a merge, "never throws" for a parser, an oracle (naive vs optimised) | the behaviour is a list of specific cases a table covers | cap examples in the affected run (20 to 50), full count in the slow lane; always seed |
| **Snapshot / golden** | the output format *is* the contract (CLI help, generated docs, a serialised file) and the snapshot is small enough to review in a diff | the snapshot is a whole component tree or a large object that churns on unrelated edits; it is a change detector then | inline snapshots; one per format, not per case; never update snapshots without reading the diff |
| **Mutation testing** (Stryker incremental, mutmut, PIT, cargo-mutants) | as a spot check that assertions bite: run on the diff only, read the survivors | as a gate with a score; as a full-repo run on every change | diff-only, a few dozen mutants, survivors in logging or messages are noise |
| **Contract test** | a fake stands in for a real dependency in every unit test | the dependency is cheap and deterministic to use for real | runs on a schedule or in the slow lane, not in the affected run |
| **Characterisation test** | upstream behaviour surprised you and the code depends on it | to pin your own code's current output "so nothing changes" | one narrow test with the surprise in its name |
| **Mutation-prove by hand** | every new behaviour test: break the code, see the failure, restore | never skipped | seconds: run only that test's file (or case) against the broken code, not the suite; the summary shows the command and the failing line |

## Stack examples

One small, one medium test per stack, showing the seam and the fixture.

### TypeScript, vitest

```ts
// core (pure): src/land/decide.ts
export function decideLand(pr: {state: string; autoMerge: boolean; headSha: string}, localSha: string) {
  if (pr.state === "OPEN" && pr.autoMerge) return {action: "refuse", reason: "queued"} as const;
  if (pr.state === "MERGED" && pr.headSha === localSha) return {action: "delete-branch"} as const;
  return {action: "keep", reason: "head differs"} as const;
}

// small test: tests/land/decide.test.ts, literal in, literal out, table for variants
it.each([
  [{state: "OPEN", autoMerge: true, headSha: "a"}, "a", "refuse"],
  [{state: "MERGED", autoMerge: false, headSha: "a"}, "a", "delete-branch"],
  [{state: "MERGED", autoMerge: false, headSha: "a"}, "b", "keep"],
])("decideLand(%o, %s) -> %s", (pr, local, action) => {
  expect(decideLand(pr, local).action).toBe(action);
});

// medium test: one temp repo per file, cases make branches inside it
const repo = await makeRepo();            // beforeAll, once
afterEach(() => repo.reset());            // back to the base commit
it("deletes the branch after a verified merge", async () => {
  await repo.branch("u1").commit("x");
  await landShell({repo, gh: fakeGh({state: "MERGED", headSha: repo.sha("u1")})});
  expect(await repo.hasBranch("u1")).toBe(false);
});
```

Affected run: `bunx vitest related <changed files> --run`; vitest config with
a `slow` project for large tests and `isolate: false` for the pure core.

### Bash

```bash
# scripts/land: functions, main guarded, so tests source the file
decide_land() { # <pr state> <auto-merge> <pr head> <local head> -> action
  local state="$1" auto="$2" pr_head="$3" local_head="$4"
  if [[ "$state" == OPEN && "$auto" == true ]]; then echo refuse; return; fi
  if [[ "$state" == MERGED && "$pr_head" == "$local_head" ]]; then echo delete-branch; return; fi
  echo keep
}
main() { ...; action="$(decide_land "$state" "$auto" "$pr_head" "$local_head")"; ...; }
[[ "${BASH_SOURCE[0]}" == "$0" ]] && main "$@"

# small test: tests/test-land-decide.sh, no repo, no gh
source scripts/land
assert_eq "queued PR is refused" refuse "$(decide_land OPEN true a a)"
assert_eq "merged with same head deletes" delete-branch "$(decide_land MERGED false a a)"
assert_eq "merged with other head keeps" keep "$(decide_land MERGED false a b)"

# medium test: one bare remote and one clone for the whole file; a branch per case
remote="$(mktemp -d)"; git init -q --bare "$remote"; clone="$(mktemp -d)"; git clone -q "$remote" "$clone"
PATH="$FIX/bin:$PATH"                      # stub gh reads GH_STATE, GH_HEAD
case_branch() { git -C "$clone" checkout -q -b "$1" main; }
case_branch bc1; GH_STATE=MERGED GH_HEAD="$(git -C "$clone" rev-parse bc1)" scripts/land bc1
assert_fails "branch gone after verified merge" git -C "$clone" show-ref --verify -q refs/heads/bc1
```

Affected run: a path map (`affected.md`) from `scripts/<name>` to
`tests/test-*<name>*.sh`, with helpers mapping to every file.

### Python, pytest

```python
# core: land/decide.py (pure)
def decide_land(pr: Pr, local_sha: str) -> Action: ...

# small test: tests/test_decide.py, parametrised, literal expectations
@pytest.mark.parametrize("pr,local,action", [
    (Pr(state="OPEN", auto_merge=True, head="a"), "a", "refuse"),
    (Pr(state="MERGED", auto_merge=False, head="a"), "a", "delete-branch"),
    (Pr(state="MERGED", auto_merge=False, head="a"), "b", "keep"),
])
def test_decide_land(pr, local, action):
    assert decide_land(pr, local).action == action

# medium test: module-scoped repo fixture, function-scoped branch
@pytest.fixture(scope="module")
def repo(tmp_path_factory): return make_repo(tmp_path_factory.mktemp("repo"))
@pytest.fixture
def branch(repo): b = repo.branch(); yield b; repo.reset()
def test_branch_deleted_after_verified_merge(repo, branch, fake_gh):
    fake_gh.pr(state="MERGED", head=repo.sha(branch))
    land_shell(repo, branch, gh=fake_gh)
    assert not repo.has_branch(branch)
```

Affected run: `pytest --testmon` when installed, else the touched test files
plus a path map; `-p no:randomly` off and `pytest-randomly` on once to prove
order independence; `hypothesis` with `max_examples=25` in the affected
profile and the default in the slow lane.
