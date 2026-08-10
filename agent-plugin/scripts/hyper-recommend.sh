#!/usr/bin/env bash
# Recommend tools from resources/recommended-tools.json for a project.
#
# Usage: hyper-recommend.sh <project-dir> [aspect ...]
#
# No aspects means all of them. Output is grouped by aspect; within a group,
# tools covering more of the detected stacks print first ("any" counts as
# covering all of them), so a cross-language formatter beats a single-language
# one in a polyglot repo.
#
# Report-only: nothing is installed or configured, and the exit code is always
# 0 — this feeds /hyper:tools, which asks the user before touching anything.
# Presence markers ([configured] when a detect.config glob matches,
# [installed] when detect.bin is on PATH) only appear when verifiable; a tool
# without a detect field is simply unmarked, never guessed at.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG="$PLUGIN_DIR/resources/recommended-tools.json"
STACKS_DIR="$PLUGIN_DIR/stacks"

if [[ $# -lt 1 ]]; then
  echo "usage: $(basename "$0") <project-dir> [aspect ...]" >&2
  exit 0
fi

dir="$(cd "$1" 2>/dev/null && pwd)" || { echo "no such directory: $1" >&2; exit 0; }
shift
aspects="$(IFS=,; echo "${*:-}")"

# Detect ALL matching stacks, not first-match-wins like hyper-stack.sh
# detect: recommendations for a node+go repo must consider both. Each detect.sh
# is sourced in a subshell so definitions cannot leak between iterations.
detected=()
for detect_file in "$STACKS_DIR"/*/detect.sh; do
  [[ -f "$detect_file" ]] || continue
  if (
    # shellcheck source=/dev/null
    source "$detect_file"
    declare -f stack_matches >/dev/null && stack_matches "$dir"
  ); then
    detected+=("$(basename "$(dirname "$detect_file")")")
  fi
done
stacks="$(IFS=,; echo "${detected[*]:-}")"

if ! command -v node >/dev/null 2>&1; then
  echo "node unavailable — read resources/recommended-tools.json directly"
  exit 0
fi

node -e '
  const fs = require("fs");
  const path = require("path");
  const [catalogPath, dir, stacksCsv, aspectsCsv] = process.argv.slice(1);

  const TAXONOMY = ["lint", "format", "typecheck", "test", "security", "ci",
                    "complexity", "deps", "docs", "hooks", "release"];

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")).tools;
  } catch (e) {
    console.log("catalog unreadable: " + e.message);
    process.exit(0);
  }

  const detected = stacksCsv ? stacksCsv.split(",").filter(Boolean) : [];
  const wanted = aspectsCsv ? aspectsCsv.split(",").filter(Boolean) : TAXONOMY;

  // Top-level-only glob match: catalog globs are file names (optionally one
  // directory deep, e.g. .github/renovate.json) using * only.
  const globMatches = (glob) => {
    const sub = path.dirname(glob);
    const base = path.basename(glob);
    const where = sub === "." ? dir : path.join(dir, sub);
    const re = new RegExp("^" + base.split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    let names;
    try { names = fs.readdirSync(where); } catch (e) { return false; }
    return names.some((n) => re.test(n));
  };

  const onPath = (bin) => (process.env.PATH || "").split(path.delimiter)
    .some((p) => { try { return p && fs.existsSync(path.join(p, bin)); } catch (e) { return false; } });

  const covers = (t) => t.stacks.includes("any")
    ? detected.length
    : t.stacks.filter((s) => detected.includes(s)).length;

  const matches = catalog.filter((t) =>
    (t.stacks.includes("any") || t.stacks.some((s) => detected.includes(s))) &&
    t.aspects.some((a) => wanted.includes(a)));

  console.log("# stacks: " + (detected.join(" ") || "none detected"));
  console.log("# aspects: " + wanted.join(" "));

  let printed = 0;
  for (const aspect of TAXONOMY) {
    if (!wanted.includes(aspect)) continue;
    const group = matches.filter((t) => t.aspects.includes(aspect))
      .sort((a, b) => covers(b) - covers(a) || a.id.localeCompare(b.id));
    if (group.length === 0) continue;
    console.log("");
    console.log("== " + aspect + " ==");
    for (const t of group) {
      const marks = [];
      const det = t.detect || {};
      if ((det.config || []).some(globMatches)) marks.push("[configured]");
      if (det.bin && onPath(det.bin)) marks.push("[installed]");
      let line = "  " + t.id + "  [" + t.stacks.join(",") + "]" +
        (marks.length ? " " + marks.join(" ") : "") +
        " " + t.description + " (docs: " + t.docs + ")";
      if (t.notes) line += " — note: " + t.notes;
      console.log(line);
      printed++;
    }
  }
  if (printed === 0) console.log("\nno matching tools");
' "$CATALOG" "$dir" "$stacks" "$aspects"

exit 0
