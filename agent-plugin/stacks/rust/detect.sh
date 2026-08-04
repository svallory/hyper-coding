#!/usr/bin/env bash
# Rust stack detection. Same contract as stacks/node/detect.sh.
#
# cargo fixes most of the toolchain by convention: fmt, check, and test ship
# with every installation, so those are safe to assert. Clippy is the one
# moving part — it is a rustup component that may not be installed.

stack_matches() {
  [[ -f "$1/Cargo.toml" ]]
}

# `cargo clippy --version` is unreliable here: hooks do not inherit the user's
# shell, so cargo may resolve without its rustup shims and report the component
# missing when it is not (or hang resolving toolchains). Check for the
# clippy-driver binary directly, falling back to rustup's component list.
_rust_has_clippy() {
  command -v clippy-driver >/dev/null 2>&1 && return 0
  if command -v rustup >/dev/null 2>&1; then
    rustup component list --installed 2>/dev/null | grep -q '^clippy' && return 0
  fi
  return 1
}

stack_detect() {
  local d="$1"
  echo "STACK=rust"
  echo "PM=cargo"
  echo "PM_RUN=cargo"

  # fmt/check/test ship with the toolchain, so like Go these are safe to
  # assert without inspecting the project.
  echo "FORMAT=cargo fmt"
  echo "TYPECHECK=cargo check"
  echo "TEST=cargo test"

  if _rust_has_clippy; then
    echo "LINT_TOOL=clippy"
    echo "LINT=cargo clippy"
  elif [[ -f "$d/clippy.toml" || -f "$d/.clippy.toml" ]]; then
    # The project configures clippy but the component is not verifiable from
    # this environment. Claiming LINT here would produce a failing hook.
    echo "LINT_TOOL=clippy"
    echo "LINT_MISSING=clippy configured but component not installed"
  fi
}
