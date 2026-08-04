#!/usr/bin/env bash
# Node/Bun/TypeScript stack detection.
#
# Contract every stack detect.sh implements:
#   stack_matches <dir>   -> 0 if this stack applies to <dir>
#   stack_detect  <dir>   -> prints KEY=VALUE lines describing the toolchain
#
# Keys emitted (absent when not found — never guessed):
#   STACK, PM, PM_RUN, LINT, FORMAT, TYPECHECK, TEST, LINT_TOOL, TYPECHECK_TOOL
#
# The design rule here is: report only what is verifiable. A missing LINT key
# means "this project has no lint script", which is different from "run
# `npm run lint` and hope". Callers must treat absence as unknown and ask.

stack_matches() {
  [[ -f "$1/package.json" ]]
}

# Package manager, in order of decreasing evidence strength: an explicit
# packageManager field beats a lockfile, which beats a default.
_node_pm() {
  local d="$1" pm

  if [[ -f "$d/package.json" ]]; then
    pm="$(node -e '
      try {
        const p = require(process.argv[1] + "/package.json");
        if (p.packageManager) process.stdout.write(String(p.packageManager).split("@")[0]);
      } catch (e) {}
    ' "$d" 2>/dev/null)"
    [[ -n "$pm" ]] && { echo "$pm"; return; }
  fi

  [[ -f "$d/bun.lockb"        ]] && { echo bun;  return; }
  [[ -f "$d/bun.lock"         ]] && { echo bun;  return; }
  [[ -f "$d/pnpm-lock.yaml"   ]] && { echo pnpm; return; }
  [[ -f "$d/yarn.lock"        ]] && { echo yarn; return; }
  [[ -f "$d/package-lock.json" ]] && { echo npm; return; }

  # No lockfile is genuinely ambiguous. Say so rather than defaulting to npm.
  echo unknown
}

# Read a script from package.json. Empty output means the script is absent.
_node_script() {
  node -e '
    try {
      const p = require(process.argv[1] + "/package.json");
      const s = (p.scripts || {})[process.argv[2]];
      if (s) process.stdout.write(process.argv[2]);
    } catch (e) {}
  ' "$1" "$2" 2>/dev/null
}

# Find the first script that exists from a list of conventional names.
# Projects disagree on naming (typecheck vs type-check vs tsc), so try the
# common variants rather than assuming one.
_node_first_script() {
  local d="$1"; shift
  local name
  for name in "$@"; do
    if [[ -n "$(_node_script "$d" "$name")" ]]; then
      echo "$name"
      return 0
    fi
  done
  return 1
}

# Identify the underlying linter, which drives which config file to reference
# and how to interpret output. Independent of the script name.
_node_lint_tool() {
  local d="$1"
  [[ -f "$d/biome.json" || -f "$d/biome.jsonc" ]] && { echo biome; return; }
  compgen -G "$d/.oxlintrc*" >/dev/null 2>&1 && { echo oxlint; return; }
  compgen -G "$d/eslint.config.*" >/dev/null 2>&1 && { echo eslint; return; }
  compgen -G "$d/.eslintrc*" >/dev/null 2>&1 && { echo eslint; return; }
  echo ""
}

stack_detect() {
  local d="$1"
  local pm run

  pm="$(_node_pm "$d")"
  echo "STACK=node"
  echo "PM=$pm"

  # `bun run` for bun, `<pm> run` otherwise. Unknown pm yields no runner,
  # which forces the caller to ask instead of guessing wrong.
  case "$pm" in
    bun)          run="bun run" ;;
    pnpm)         run="pnpm run" ;;
    yarn)         run="yarn" ;;
    npm)          run="npm run" ;;
    *)            run="" ;;
  esac
  [[ -n "$run" ]] && echo "PM_RUN=$run"

  local s
  s="$(_node_first_script "$d" lint lint:all check)" && echo "LINT=$s"
  s="$(_node_first_script "$d" format fmt prettier)" && echo "FORMAT=$s"
  s="$(_node_first_script "$d" typecheck type-check types tsc)" && echo "TYPECHECK=$s"
  s="$(_node_first_script "$d" test)" && echo "TEST=$s"

  local tool
  tool="$(_node_lint_tool "$d")"
  [[ -n "$tool" ]] && echo "LINT_TOOL=$tool"

  # tsconfig.json means tsc is available even without a typecheck script —
  # useful to report, but callers must not invent a script that isn't there.
  [[ -f "$d/tsconfig.json" ]] && echo "TYPECHECK_TOOL=tsc"
}
