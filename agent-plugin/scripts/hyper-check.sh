#!/usr/bin/env bash
# PostToolUse hook: run the project's own checks after an edit and feed
# failures back to the agent immediately.
#
# This implements Hyper's "Tools Integration" and "Real-time Feedback"
# principles: the agent gets the same linter/typechecker signal a human gets
# from their editor, at the moment the mistake is made rather than at review.
#
# It is OFF unless the project opts in via .claude/hyper.json, because the
# correct commands are project-specific and a wrong one is worse than none —
# a check that always fails trains everyone to ignore it.
#
# Config (project .claude/hyper.json) — single check:
#   {
#     "check": {
#       "enabled": true,
#       "run": "typecheck",            // or an explicit "command"
#       "command": "bun run typecheck",
#       "extensions": [".ts", ".tsx"], // limit to files worth checking
#       "timeout": 60
#     }
#   }
#
# or several, each with its own filter ("checks" wins when both are present;
# writing the array is the opt-in, entries may set "enabled": false):
#   {
#     "checks": [
#       { "run": "lint",      "extensions": [".ts", ".tsx"], "timeout": 30 },
#       { "run": "typecheck", "extensions": [".ts", ".tsx"], "timeout": 60 }
#     ]
#   }

set -uo pipefail

# Hook input arrives as JSON on stdin. No jq dependency: node is already a
# prerequisite for the Node stack, and Go projects that lack it simply skip.
input="$(cat 2>/dev/null || true)"
[[ -z "$input" ]] && exit 0

command -v node >/dev/null 2>&1 || exit 0

# Extract the edited file path and the session id (used to dedup environment
# errors) in one pass. Tolerate every shape the hook payload takes.
extracted="$(node -e '
  let raw = "";
  process.stdin.on("data", d => raw += d);
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(raw);
      const i = j.tool_input || {};
      process.stdout.write((i.file_path || i.notebook_path || "") + "\n"
                           + (j.session_id || ""));
    } catch (e) {}
  });
' <<<"$input" 2>/dev/null)"
file_path="${extracted%%$'\n'*}"
# With no session_id the trailing newline is stripped by the command
# substitution, so require a real separator before taking the second field.
session_id=""
[[ "$extracted" == *$'\n'* ]] && session_id="${extracted##*$'\n'}"

[[ -z "$file_path" ]] && exit 0
[[ -f "$file_path" ]] || exit 0

# Walk up from the edited file to find the project config.
dir="$(cd "$(dirname "$file_path")" && pwd)"
cfg=""
probe="$dir"
while [[ "$probe" != "/" ]]; do
  # hyper.json wins; hyperdev.json is the legacy (pre-rename) name and keeps
  # working as a fallback so committed project config never silently breaks.
  if [[ -f "$probe/.claude/hyper.json" ]]; then
    cfg="$probe/.claude/hyper.json"
    root="$probe"
    break
  fi
  if [[ -f "$probe/.claude/hyperdev.json" ]]; then
    cfg="$probe/.claude/hyperdev.json"
    root="$probe"
    break
  fi
  probe="$(dirname "$probe")"
done

[[ -z "$cfg" ]] && exit 0

# Read config. Any parse error disables the hook rather than guessing.
# Node emits one tab-separated record per active check; string fields are
# base64 so quoting survives intact — no eval, no quote stripping.
checks="$(node -e '
  const fs = require("fs");
  const b64 = s => Buffer.from(String(s ?? ""), "utf8").toString("base64");
  try {
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let list = [];
    if (Array.isArray(cfg.checks) && cfg.checks.length) {
      list = cfg.checks.filter(c => c && typeof c === "object" && c.enabled !== false);
    } else if (cfg.check && cfg.check.enabled) {
      list = [cfg.check];
    }
    for (const c of list) {
      // "|" is not in the base64 alphabet, and unlike tab it is not IFS
      // whitespace, so empty fields survive the shell read.
      console.log(["C", b64(c.run || ""), b64(c.command || ""),
                   parseInt(c.timeout, 10) || 60,
                   b64((c.extensions || []).join(" "))].join("|"));
    }
  } catch (e) {}
' "$cfg" 2>/dev/null)"

[[ -z "$checks" ]] && exit 0

# Stock macOS ships no `timeout`, and the hook may not see homebrew's PATH.
# Fall back to gtimeout, then to running with no limit at all — a missing
# timeout binary must never turn a healthy edit into a failed check.
timeout_bin=""
if command -v timeout >/dev/null 2>&1; then
  timeout_bin="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_bin="gtimeout"
fi

pm_run=""
pm_run_resolved=0

while IFS='|' read -r tag run_b64 cmd_b64 tmo exts_b64; do
  [[ "$tag" != "C" ]] && continue
  run="$(printf %s "$run_b64" | base64 -d 2>/dev/null)"
  cmd="$(printf %s "$cmd_b64" | base64 -d 2>/dev/null)"
  exts="$(printf %s "$exts_b64" | base64 -d 2>/dev/null)"

  # Honour the extension filter when present; editing a README should not
  # trigger a typecheck.
  if [[ -n "$exts" ]]; then
    matched=0
    for ext in $exts; do
      [[ "$file_path" == *"$ext" ]] && matched=1 && break
    done
    [[ $matched -eq 0 ]] && continue
  fi

  # Resolve the command: an explicit command wins; otherwise use the detected
  # package runner plus the configured script name.
  if [[ -z "$cmd" && -n "$run" ]]; then
    if [[ $pm_run_resolved -eq 0 ]]; then
      pm_run="$(bash "$(dirname "${BASH_SOURCE[0]}")/hyper-stack.sh" detect "$root" </dev/null 2>/dev/null \
                | sed -n 's/^PM_RUN=//p')"
      pm_run_resolved=1
    fi
    [[ -z "$pm_run" ]] && continue   # unknown package manager — do not guess
    cmd="$pm_run $run"
  fi
  [[ -z "$cmd" ]] && continue

  # bash -c takes the command as one string, so quoting inside it is the
  # project's own and reaches the shell untouched. stdin is /dev/null: it is
  # otherwise still attached to the herestring feeding this loop, and a check
  # that reads stdin would silently drain the remaining check records.
  if [[ -n "$timeout_bin" ]]; then
    out="$(cd "$root" && "$timeout_bin" "$tmo" bash -c "$cmd" </dev/null 2>&1)"
  else
    out="$(cd "$root" && bash -c "$cmd" </dev/null 2>&1)"
  fi
  status=$?

  [[ $status -eq 0 ]] && continue

  # 124 is timeout's signal. Report it as a timeout rather than a code
  # failure, so nobody chases a type error that never happened.
  if [[ -n "$timeout_bin" && $status -eq 124 ]]; then
    echo "hyper: check timed out after ${tmo}s: $cmd" >&2
    exit 2
  fi

  # 126/127 mean the command itself could not run (not found / not
  # executable) — an environment problem, not a code failure. The code being
  # edited cannot fix it, so report it once per session and go quiet: the
  # same error on every edit trains the agent to ignore hook feedback.
  if [[ $status -eq 126 || $status -eq 127 ]]; then
    seen_env="${TMPDIR:-/tmp}/hyper-check-envfail-${session_id:-$PPID}"
    if ! grep -qxF "$cmd" "$seen_env" 2>/dev/null; then
      printf '%s\n' "$cmd" >>"$seen_env" 2>/dev/null || true
      {
        echo "hyper: check command not runnable (exit $status): $cmd"
        echo "$out" | tail -5
        echo "(environment problem, not a code failure — reported once; this session will not repeat it)"
      } >&2
      exit 2
    fi
    continue
  fi

  # Exit 2 feeds stderr back to the agent as actionable feedback.
  {
    echo "hyper: project check failed after editing $file_path"
    echo "command: $cmd"
    echo
    echo "$out" | tail -50
  } >&2
  exit 2
done <<<"$checks"

exit 0
