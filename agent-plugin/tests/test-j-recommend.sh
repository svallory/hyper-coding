#!/usr/bin/env bash
# Row J — tool recommendations (hyper-recommend.sh + the catalog). The
# governing rules under test: the catalog is machine-valid, matching is
# stacks ∩ detected plus "any", presence markers appear only when verifiable,
# and in a polyglot repo cross-stack tools outrank single-stack ones.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

RECOMMEND="$SCRIPTS_DIR/hyper-recommend.sh"
CATALOG="$PLUGIN_DIR/resources/recommended-tools.json"

recommend() { bash "$RECOMMEND" "$@" 2>&1; }

# line_of <output> <needle> — 1-based line number of the first matching line
line_of() { printf '%s\n' "$1" | grep -n -- "$2" | head -1 | cut -d: -f1; }

# J1-J5: catalog validity ---------------------------------------------------

assert_ok "catalog is valid JSON" \
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$CATALOG"

validate() {
  node -e '
    const tools = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).tools;
    const check = process.argv[2];
    const STACKS = ["node", "go", "rust", "python", "any"];
    const ASPECTS = ["lint", "format", "typecheck", "test", "security", "ci",
                     "complexity", "deps", "docs", "hooks", "release"];
    for (const t of tools) {
      if (check === "fields") {
        for (const f of ["id", "name", "description", "docs", "repo", "stacks", "aspects"])
          if (t[f] === undefined || t[f].length === 0) { console.error(t.id + " missing " + f); process.exit(1); }
      }
      if (check === "stacks" && t.stacks.some((s) => !STACKS.includes(s)))
        { console.error(t.id + " bad stack"); process.exit(1); }
      if (check === "aspects" && t.aspects.some((a) => !ASPECTS.includes(a)))
        { console.error(t.id + " bad aspect"); process.exit(1); }
    }
    if (check === "ids" && new Set(tools.map((t) => t.id)).size !== tools.length)
      { console.error("duplicate ids"); process.exit(1); }
  ' "$CATALOG" "$1"
}

assert_ok "every entry has id/name/description/docs/repo/stacks/aspects" validate fields
assert_ok "every stacks value is in the allowed set" validate stacks
assert_ok "every aspects value is in the taxonomy" validate aspects
assert_ok "tool ids are unique" validate ids

# J6: node-only fixture, aspects lint+format --------------------------------

d="$FIX/j-node"; mkdir -p "$d"
echo '{}' > "$d/package.json"
out="$(recommend "$d" lint format)"
assert_contains "node-only lint+format recommends biome" "$out" $'\n  biome '
assert_not_contains "node-only never surfaces go tools" "$out" "golangci-lint"
assert_ok "node-only run exits 0" bash "$RECOMMEND" "$d" lint format

# J7: polyglot node+go, aspect format — cross-stack tools rank first --------

d="$FIX/j-poly"; mkdir -p "$d"
echo '{}' > "$d/package.json"
printf 'module example.test/j\n\ngo 1.22\n' > "$d/go.mod"
out="$(recommend "$d" format)"
assert_contains "polyglot detects both stacks" "$out" "node"
assert_contains "polyglot detects both stacks (go)" "$out" "go"
dprint_ln="$(line_of "$out" '^  dprint ')"
gofumpt_ln="$(line_of "$out" '^  gofumpt ')"
prettier_ln="$(line_of "$out" '^  prettier ')"
if [[ -n "$dprint_ln" && -n "$gofumpt_ln" && "$dprint_ln" -lt "$gofumpt_ln" ]]; then
  pass "dprint (any) prints before gofumpt (go-only)"
else
  fail "dprint (any) prints before gofumpt (go-only) (dprint=$dprint_ln gofumpt=$gofumpt_ln)"
fi
if [[ -n "$dprint_ln" && -n "$prettier_ln" && "$dprint_ln" -lt "$prettier_ln" ]]; then
  pass "dprint (any) prints before prettier (node-only)"
else
  fail "dprint (any) prints before prettier (node-only) (dprint=$dprint_ln prettier=$prettier_ln)"
fi

# J8: presence marker — biome.json in the project ---------------------------

d="$FIX/j-conf"; mkdir -p "$d"
echo '{}' > "$d/package.json"
echo '{}' > "$d/biome.json"
out="$(recommend "$d" lint)"
biome_line="$(printf '%s\n' "$out" | grep '^  biome ')"
assert_contains "biome.json marks biome [configured]" "$biome_line" "[configured]"
out2="$(recommend "$FIX/j-node" lint)"
biome_bare="$(printf '%s\n' "$out2" | grep '^  biome ')"
assert_not_contains "no biome.json -> no [configured] mark" "$biome_bare" "[configured]"

# J9: no aspects arg — all aspects, multiple group headers ------------------

out="$(recommend "$FIX/j-poly")"
headers="$(printf '%s\n' "$out" | grep -c '^== .* ==$')"
if [[ "$headers" -ge 3 ]]; then
  pass "no-aspect run prints multiple aspect group headers ($headers)"
else
  fail "no-aspect run prints multiple aspect group headers (got $headers)"
fi

# J10: unknown aspect — no matches, still exit 0 ----------------------------

out="$(recommend "$FIX/j-node" flavor)"
assert_contains "unknown aspect yields no matches" "$out" "no matching tools"
assert_ok "unknown aspect still exits 0" bash "$RECOMMEND" "$FIX/j-node" flavor

finish
