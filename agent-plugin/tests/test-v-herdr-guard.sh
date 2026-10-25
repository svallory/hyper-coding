#!/usr/bin/env bash
# Row V — C-12: no test can reach a real multiplexer server. tests/run.sh exports
# SHIP_MUX_TEST=1 and puts a fail-loud `herdr` stub first on PATH; this row checks
# that the environment it was given really has both, so deleting either from
# run.sh fails here. Run it through tests/run.sh, or by hand with
# `SHIP_MUX_TEST=1 PATH=<stub dir>:$PATH`.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

assert_eq "SHIP_MUX_TEST=1 is exported by the runner" "1" "${SHIP_MUX_TEST:-}"

h=herd; h+=r
herdr_path="$(command -v "$h" 2>/dev/null || true)"
assert_ok "a herdr is first on PATH" test -n "$herdr_path"
# Read it, never run it: without the stub this path could be a real herdr.
assert_ok "the herdr on PATH is the fail-loud stub" grep -q "must never run" "$herdr_path"

# The backend refuses everything under the guard, and never reaches the stub.
backend="$SCRIPTS_DIR/ship/mux/herdr"
if [[ "${SHIP_MUX_TEST:-}" == 1 ]]; then   # without the guard this could reach a real server
  out="$(HERDR_ENV=1 "$backend" check 2>&1)"; rc=$?
  assert_eq "mux/herdr exits 99 under SHIP_MUX_TEST=1" "99" "$rc"
  assert_not_contains "mux/herdr never ran the herdr stub" "$out" "must never run"
else
  fail "mux/herdr exits 99 under SHIP_MUX_TEST=1 (not run: the guard is not exported)"
fi

finish
