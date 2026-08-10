#!/usr/bin/env bash
# Python stack detection. Same contract as stacks/node/detect.sh.
#
# Python has no single blessed toolchain: the package manager, linter,
# type checker, and test runner are all independent choices. Everything
# here is inferred from config files actually present — a runnable command
# is only emitted when both a runner (PM_RUN) and a visible dependency
# declaration back it up.

stack_matches() {
  [[ -f "$1/pyproject.toml" || -f "$1/requirements.txt" || -f "$1/setup.py" ]]
}

# Package manager, in order of decreasing evidence strength: a lockfile pins
# the manager; a bare requirements.txt implies pip only when nothing stronger
# contradicts it. No evidence at all is genuinely ambiguous — say so.
_py_pm() {
  local d="$1"
  [[ -f "$d/uv.lock"      ]] && { echo uv;     return; }
  [[ -f "$d/poetry.lock"  ]] && { echo poetry; return; }
  [[ -f "$d/Pipfile.lock" ]] && { echo pipenv; return; }
  if [[ -f "$d/requirements.txt" && ! -f "$d/pyproject.toml" ]]; then
    echo pip
    return
  fi
  echo unknown
}

# True when pyproject.toml declares a [tool.<name>] table (including
# subtables like [tool.pytest.ini_options]).
_py_tool_table() {
  local d="$1" name="$2"
  [[ -f "$d/pyproject.toml" ]] || return 1
  grep -qE "^\[tool\.${name}(\.|])" "$d/pyproject.toml" 2>/dev/null
}

# True when <pkg> is visibly declared as a dependency. A textual match with a
# boundary after the name avoids matching e.g. pytest-cov for pytest... but a
# comment mentioning the package can still fool this; it is evidence, not proof.
_py_dep() {
  local d="$1" pkg="$2"
  if [[ -f "$d/pyproject.toml" ]]; then
    grep -qE "[\"']${pkg}([\"'<>=!~; \[]|$)" "$d/pyproject.toml" 2>/dev/null && return 0
  fi
  if [[ -f "$d/requirements.txt" ]]; then
    grep -qE "^${pkg}([<>=!~; \[]|$)" "$d/requirements.txt" 2>/dev/null && return 0
  fi
  return 1
}

stack_detect() {
  local d="$1"
  local pm run=""

  pm="$(_py_pm "$d")"
  echo "STACK=python"
  echo "PM=$pm"

  # pip has no runner (no `pip run`); unknown pm yields none either. Both
  # force the caller to ask instead of guessing wrong.
  case "$pm" in
    uv)     run="uv run" ;;
    poetry) run="poetry run" ;;
    pipenv) run="pipenv run" ;;
  esac
  [[ -n "$run" ]] && echo "PM_RUN=$run"

  # Tools are asserted from config presence only. The runnable command is
  # emitted only when a runner exists AND the tool is a visible dependency —
  # a configured-but-uninstalled tool would make the hook fail on every edit.
  if [[ -f "$d/ruff.toml" || -f "$d/.ruff.toml" ]] || _py_tool_table "$d" ruff; then
    echo "LINT_TOOL=ruff"
    [[ -n "$run" ]] && _py_dep "$d" ruff && echo "LINT=$run ruff check"
  fi

  if [[ -f "$d/mypy.ini" ]] || _py_tool_table "$d" mypy; then
    echo "TYPECHECK_TOOL=mypy"
    [[ -n "$run" ]] && _py_dep "$d" mypy && echo "TYPECHECK=$run mypy"
  fi

  if [[ -f "$d/pytest.ini" ]] || _py_tool_table "$d" pytest \
     || { [[ -d "$d/tests" ]] && _py_dep "$d" pytest; }; then
    echo "TEST_TOOL=pytest"
    [[ -n "$run" ]] && _py_dep "$d" pytest && echo "TEST=$run pytest"
  fi
}
