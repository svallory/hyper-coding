#!/usr/bin/env bash
# Row O — the plugin's dependency on the hyper CLI.
#
# The plugin keeps no copy of hyper-lib.sh (C-5): the scripts reach it through
# `hyper space lib-path`. That makes "what happens with no CLI, or with a CLI
# too old to satisfy the contract" a user-facing behaviour, not an internal
# detail, so it gets asserted here rather than left to be discovered.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

REQUIRE_LIB="$SCRIPTS_DIR/hyper-require-lib.sh"
CONTEXT="$SCRIPTS_DIR/hyper-context.sh"

# A PATH with no hyper anywhere on it. helpers.sh prepends the tests dir (which
# holds the real shim), so every "no CLI" case must rebuild PATH from scratch.
NO_HYPER_PATH="/usr/bin:/bin"

# fake_hyper_dir <body> — a directory holding a `hyper` that runs <body>.
fake_hyper_dir() {
  local dir="$1" body="$2"
  mkdir -p "$dir"
  printf '#!/usr/bin/env bash\n%s\n' "$body" > "$dir/hyper"
  chmod +x "$dir/hyper"
  echo "$dir"
}

# --- O1: the SessionStart hook is silent when there is no CLI -----------------

# A plain directory that is not a space at all.
d="$FIX/o1"; make_checkout "$d"
out="$( (cd "$d" && PATH="$NO_HYPER_PATH" bash "$CONTEXT" 2>&1) )"; rc=$?
assert_eq "no CLI + plain checkout: exit 0" 0 "$rc"
assert_eq "no CLI + plain checkout: prints nothing" "" "$out"

# A `hyper` that is on PATH but does not implement `space lib-path` (exit 127
# is what a wrapper gives for an unknown subcommand). That must be treated the
# same as no CLI at all, not as a working one.
d="$FIX/o2"; make_checkout "$d"
fake="$(fake_hyper_dir "$FIX/o2-bin" 'echo "unknown command" >&2; exit 127')"
out="$( (cd "$d" && PATH="$fake:$NO_HYPER_PATH" bash "$CONTEXT" 2>&1) )"; rc=$?
assert_eq "broken hyper (exit 127) + plain checkout: exit 0" 0 "$rc"
assert_eq "broken hyper (exit 127) + plain checkout: prints nothing" "" "$out"

# --- O2: …but says so when there is no CLI AND this is a space ---------------

# The one deliberate exception to the hook's silence. A user in a real space
# with no CLI otherwise gets a hook that says nothing, and then every /hyper:
# command fails with an install message nothing in the session mentioned.
d="$FIX/o3"; make_multi_space "$d" solo   # writes HYPER.md
mkdir -p "$d/notes"
out="$( (cd "$d/notes" && PATH="$NO_HYPER_PATH" bash "$CONTEXT" 2>/dev/null) )"; rc=$?
assert_eq "no CLI + real space: still exit 0 (never fails a session)" 0 "$rc"
nonempty="$(printf '%s\n' "$out" | grep -c . || true)"
assert_eq "no CLI + real space: exactly one line" 1 "$nonempty"
assert_contains "no CLI + real space: names the CLI to install" "$out" "@hypercli/cli"

# The same, from inside a repo of a multi space (deeper nesting).
out="$( (cd "$d/code/solo" && PATH="$NO_HYPER_PATH" bash "$CONTEXT" 2>/dev/null) )"; rc=$?
assert_eq "no CLI + inside a repo dir: exit 0" 0 "$rc"
assert_contains "no CLI + inside a repo dir: names the CLI" "$out" "@hypercli/cli"

# A bare space with no marker is NOT reported. This hook deliberately does not
# re-implement space_layout to decide that (C-1/C-5: the library is the
# authority on layout), so a marker is the only signal available without it.
# Pinned here so the limitation is a decision, not a surprise.
d="$FIX/o3b"; make_bare_space "$d"
out="$( (cd "$d" && PATH="$NO_HYPER_PATH" bash "$CONTEXT" 2>&1) )"; rc=$?
assert_eq "no CLI + unmarked bare space: exit 0" 0 "$rc"
assert_eq "no CLI + unmarked bare space: stays silent (no marker to go on)" "" "$out"

# --- O3: the strict path refuses, and says what to install -------------------

out="$(PATH="$NO_HYPER_PATH" bash -c "source '$REQUIRE_LIB'; hyper_require_lib" 2>&1)"; rc=$?
assert_eq "hyper_require_lib without the CLI exits 2" 2 "$rc"
assert_contains "…and names the package to install" "$out" "@hypercli/cli"
assert_contains "…and names the subcommand it needs" "$out" "hyper space lib-path"

# A hyper that exists but exits 127 is the same situation.
fake="$(fake_hyper_dir "$FIX/o4-bin" 'exit 127')"
out="$(PATH="$fake:$NO_HYPER_PATH" bash -c "source '$REQUIRE_LIB'; hyper_require_lib" 2>&1)"; rc=$?
assert_eq "hyper_require_lib with a broken hyper exits 2" 2 "$rc"
assert_contains "…and still names the package" "$out" "@hypercli/cli"

# --- O4: the version contract ------------------------------------------------

# The library the plugin gets can be older than the plugin expects. Without the
# check that mismatch surfaces mid-script as "space_layout: command not found",
# halfway through a conversion. Assert we get the install/update message first.
#
# The assertion must be on text only the outdated branch prints:
# "update @hypercli/cli" also appears in the generic "install or update"
# message, so matching on that would keep passing even if the outdated branch
# were deleted entirely. "needs hyper-lib.sh v" is the branch's marker.
old_lib="$FIX/old-lib"; mkdir -p "$old_lib"
printf '#!/usr/bin/env bash\nHYPER_LIB_VERSION=0\n' > "$old_lib/hyper-lib.sh"
fake="$(fake_hyper_dir "$FIX/o5-bin" "echo '$old_lib/hyper-lib.sh'")"
out="$(PATH="$fake:$NO_HYPER_PATH" bash -c "source '$REQUIRE_LIB'; hyper_require_lib" 2>&1)"; rc=$?
assert_eq "too-old library exits 2 rather than dying later" 2 "$rc"
assert_contains "…and takes the update branch, not the generic one" "$out" "needs hyper-lib.sh v"

# A library found and sourced but stamped with NO version at all is an older
# one — the stamp arrived with the contract — and must route to the same
# "outdated" message, not the generic "the CLI is required" one.
no_lib_ver="$FIX/no-ver-lib"; mkdir -p "$no_lib_ver"
printf '#!/usr/bin/env bash\n# no HYPER_LIB_VERSION stamp\n' > "$no_lib_ver/hyper-lib.sh"
fake="$(fake_hyper_dir "$FIX/o6-bin" "echo '$no_lib_ver/hyper-lib.sh'")"
out="$(PATH="$fake:$NO_HYPER_PATH" bash -c "source '$REQUIRE_LIB'; hyper_require_lib" 2>&1)"; rc=$?
assert_eq "unstamped library also exits 2" 2 "$rc"
assert_contains "unstamped library takes the update branch too" "$out" "needs hyper-lib.sh v"

# Sourcing the helper twice must not crash: the readonly guard exists because
# `readonly X=1` on a second source exits 1 under set -e.
out="$(bash -c "source '$REQUIRE_LIB'; set -e; source '$REQUIRE_LIB'; echo STILL-HERE" 2>&1)"; rc=$?
assert_eq "sourcing the helper twice does not abort under set -e" 0 "$rc"
assert_contains "…and the second source ran" "$out" "STILL-HERE"

# The real library satisfies the contract.
out="$(bash -c "source '$REQUIRE_LIB'; hyper_require_lib && echo OK" 2>&1)"; rc=$?
assert_eq "the real library passes the version check" 0 "$rc"
assert_contains "…and loads it" "$out" "OK"

finish
