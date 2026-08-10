#!/usr/bin/env bash
# Go stack detection. Same contract as stacks/node/detect.sh.
#
# Go is simpler than Node: the toolchain is largely fixed by convention, so
# detection is mostly about which optional linter is configured rather than
# which of five package managers is in use.

stack_matches() {
  [[ -f "$1/go.mod" ]]
}

stack_detect() {
  local d="$1"
  echo "STACK=go"
  echo "PM=go"
  echo "PM_RUN=go"

  # gofmt/vet/test/build ship with the toolchain, so unlike Node these are
  # safe to assert without inspecting the project.
  echo "FORMAT=gofmt"
  echo "TYPECHECK=go build ./..."
  echo "TEST=go test ./..."
  echo "VET=go vet ./..."

  # golangci-lint is the common aggregator but is not part of the toolchain,
  # so only claim it when both the config and the binary exist.
  if compgen -G "$d/.golangci.y*ml" >/dev/null 2>&1; then
    echo "LINT_TOOL=golangci-lint"
    if command -v golangci-lint >/dev/null 2>&1; then
      echo "LINT=golangci-lint run"
    else
      echo "LINT_MISSING=golangci-lint configured but not installed"
    fi
  fi

  # A Makefile often wraps the real entry points; worth surfacing so callers
  # prefer `make lint` over a raw command when the project defines one.
  if [[ -f "$d/Makefile" ]]; then
    grep -qE '^lint:' "$d/Makefile" 2>/dev/null && echo "MAKE_LINT=make lint"
    grep -qE '^test:' "$d/Makefile" 2>/dev/null && echo "MAKE_TEST=make test"
  fi
}
