#!/usr/bin/env bash
# PostToolUse hook: when an edit adds a NEW dependency to a manifest, feed
# back a one-time prompt to justify it.
#
# This implements Hyper's "Engineered Friction" principle: adding a
# dependency is a long-term commitment that deserves one sentence of thought,
# not a review-time argument. The prompt fires once per dependency per
# session — a hook that nags on every edit trains everyone to ignore it.
#
# It is OFF unless the project opts in via .claude/hyper.json:
#   { "deps": { "enabled": true } }
#
# Every failure path here (parse error, git error, missing node) exits 0
# silently: this hook must be impossible to false-positive.

set -uo pipefail

# Hook input arrives as JSON on stdin. No jq dependency: node is already a
# prerequisite for the Node stack, and projects that lack it simply skip.
input="$(cat 2>/dev/null || true)"
[[ -z "$input" ]] && exit 0

command -v node >/dev/null 2>&1 || exit 0
command -v git  >/dev/null 2>&1 || exit 0

# Extract the edited file path and the session id (used to key the once-per-
# session dedup) in one pass. Tolerate every shape the hook payload takes.
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

# Only manifests are worth diffing.
base="$(basename "$file_path")"
case "$base" in
  package.json|go.mod|Cargo.toml|pyproject.toml|requirements.txt) ;;
  *) exit 0 ;;
esac

# Walk up from the edited file to find the project config.
dir="$(cd "$(dirname "$file_path")" && pwd)"
cfg=""
probe="$dir"
while [[ "$probe" != "/" ]]; do
  # hyper.json wins; hyperdev.json is the legacy (pre-rename) name and keeps
  # working as a fallback so committed project config never silently breaks.
  if [[ -f "$probe/.claude/hyper.json" ]]; then
    cfg="$probe/.claude/hyper.json"
    break
  fi
  if [[ -f "$probe/.claude/hyperdev.json" ]]; then
    cfg="$probe/.claude/hyperdev.json"
    break
  fi
  probe="$(dirname "$probe")"
done

[[ -z "$cfg" ]] && exit 0

# Read config. Any parse error disables the hook rather than guessing.
enabled="$(node -e '
  const fs = require("fs");
  try {
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).deps || {};
    process.stdout.write(c.enabled ? "1" : "0");
  } catch (e) {
    process.stdout.write("0");
  }
' "$cfg" 2>/dev/null)"

[[ "$enabled" != "1" ]] && exit 0

# Locate the committed version of this manifest. A file not in HEAD is new —
# nothing to diff against, so every dep would be "new"; skip instead of spam.
top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[[ -z "$top" ]] && exit 0
relpath="${file_path#"$top"/}"
old_content="$(git -C "$top" show "HEAD:$relpath" 2>/dev/null)" || exit 0

# Print the dependency names declared in a manifest read from stdin, one per
# line. Names only — version bumps are not new dependencies.
dep_names() {
  case "$1" in
    package.json)
      node -e '
        let raw = "";
        process.stdin.on("data", d => raw += d);
        process.stdin.on("end", () => {
          try {
            const j = JSON.parse(raw);
            const names = Object.keys(j.dependencies || {})
              .concat(Object.keys(j.devDependencies || {}));
            process.stdout.write(names.join("\n"));
          } catch (e) { process.exit(3); }
        });
      ' 2>/dev/null || return 1
      ;;
    go.mod)
      awk '
        /^require[ \t]+\(/ { inblock = 1; next }
        inblock && /^\)/   { inblock = 0; next }
        inblock            { sub(/^[ \t]+/, ""); if ($1 != "" && $1 !~ /^\/\//) print $1 }
        /^require[ \t]+[^(]/ { print $2 }
      '
      ;;
    Cargo.toml)
      awk '
        /^\[/ { insec = ($0 ~ /^\[(dependencies|dev-dependencies)\]/); next }
        insec && /^[A-Za-z0-9_-]+[ \t]*=/ {
          split($0, a, "="); gsub(/[ \t"]/, "", a[1]); print a[1]
        }
      '
      ;;
    pyproject.toml)
      # [project] dependencies (PEP 621 array of requirement strings, possibly
      # multiline) and [tool.poetry.dependencies] table keys.
      awk '
        /^\[/ { sec = $0; indeps = 0 }
        sec ~ /^\[project\]/ && /^dependencies[ \t]*=[ \t]*\[/ { indeps = 1 }
        indeps {
          line = $0
          while (match(line, /"[^"]+"/)) {
            spec = substr(line, RSTART + 1, RLENGTH - 2)
            if (match(spec, /^[A-Za-z0-9][A-Za-z0-9._-]*/))
              print substr(spec, RSTART, RLENGTH)
            line = substr(line, RSTART + RLENGTH)
          }
          if ($0 ~ /\]/) indeps = 0
        }
        sec ~ /^\[tool\.poetry\.dependencies\]/ && /^[A-Za-z0-9_.-]+[ \t]*=/ {
          split($0, a, "="); gsub(/[ \t"]/, "", a[1])
          if (a[1] != "python") print a[1]
        }
      '
      ;;
    requirements.txt)
      # Skip comments, blanks, and option lines (-r, -e, --hash …); take the
      # name up to the first version/extras/marker character.
      awk '
        /^[ \t]*(#|-|$)/ { next }
        {
          line = $0; sub(/[ \t]*#.*/, "", line)
          if (match(line, /^[A-Za-z0-9][A-Za-z0-9._-]*/))
            print substr(line, RSTART, RLENGTH)
        }
      '
      ;;
  esac
}

old_names="$(dep_names "$base" <<<"$old_content")" || exit 0
new_names="$(dep_names "$base" <"$file_path")" || exit 0

added="$(comm -13 <(sort -u <<<"$old_names") <(sort -u <<<"$new_names") | grep -v '^$' || true)"
[[ -z "$added" ]] && exit 0

# Once per dependency per session, keyed by the hook payload's session_id —
# unique per session, so a recycled PID cannot replay a dead session's dedup
# state. $PPID (the Claude Code process) is only the fallback for payloads
# without one. ${TMPDIR:-/tmp} rather than a hardcoded /tmp: TMPDIR is
# per-user on macOS, so another user's stale file can neither collide with
# nor silently disable this hook.
seen_file="${TMPDIR:-/tmp}/hyper-deps-${session_id:-$PPID}"
touch "$seen_file" 2>/dev/null || exit 0

unseen=""
while IFS= read -r dep; do
  grep -qxF "$relpath:$dep" "$seen_file" 2>/dev/null && continue
  printf '%s:%s\n' "$relpath" "$dep" >>"$seen_file"
  unseen="$unseen $dep"
done <<<"$added"
unseen="${unseen# }"

[[ -z "$unseen" ]] && exit 0

# Exit 2 feeds stderr back to the agent as actionable feedback.
echo "hyper: new dependency $unseen added to $base. State in one sentence why an existing dependency or stdlib cannot do this, then continue. If it cannot be justified, remove it." >&2
exit 2
