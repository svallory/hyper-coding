#!/usr/bin/env bash
# Row E — stack dispatch (hyper-stack.sh detect). The governing rule under
# test: report only what is verifiable. PM=unknown and an absent PM_RUN are
# the correct answers when the evidence is missing — never a default.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

STACK="$SCRIPTS_DIR/hyper-stack.sh"

detect() { bash "$STACK" detect "$1" 2>&1; }

# E1: node project with a bun lockfile
d="$FIX/e1"; mkdir -p "$d"
echo '{}' > "$d/package.json"
touch "$d/bun.lock"
out="$(detect "$d")"
assert_contains "bun lockfile -> STACK=node" "$out" "STACK=node"
assert_contains "bun lockfile -> PM=bun"     "$out" $'\nPM=bun'
assert_contains "bun lockfile -> PM_RUN=bun run" "$out" "PM_RUN=bun run"

# E2: node project with no lockfile — genuinely ambiguous
d="$FIX/e2"; mkdir -p "$d"
echo '{}' > "$d/package.json"
out="$(detect "$d")"
assert_contains "no lockfile -> PM=unknown" "$out" "PM=unknown"
assert_not_contains "no lockfile -> no PM_RUN guessed" "$out" "PM_RUN="

# E3: polyglot node+go — one winner's keys, others as a trailing comment
d="$FIX/e3"; mkdir -p "$d"
echo '{}' > "$d/package.json"
printf 'module example.test/e3\n\ngo 1.22\n' > "$d/go.mod"
out="$(detect "$d")"
assert_eq "polyglot emits a single PM= line" 1 "$(printf '%s\n' "$out" | grep -c '^PM=')"
assert_eq "polyglot emits a single STACK= line" 1 "$(printf '%s\n' "$out" | grep -c '^STACK=')"
assert_contains "other matches surface as a comment" "$out" "# also matches:"

# E4: empty dir — no stack matches
d="$FIX/e4"; mkdir -p "$d"
out="$(detect "$d")"
assert_contains "empty dir -> STACK=unknown" "$out" "STACK=unknown"

# E5: rust — cargo toolchain is fixed by convention, safe to assert
d="$FIX/e5"; mkdir -p "$d"
printf '[package]\nname = "e5"\nversion = "0.1.0"\n' > "$d/Cargo.toml"
out="$(detect "$d")"
assert_contains "Cargo.toml -> STACK=rust"       "$out" "STACK=rust"
assert_contains "rust -> PM=cargo"               "$out" $'\nPM=cargo'
assert_contains "rust -> TYPECHECK=cargo check"  "$out" "TYPECHECK=cargo check"

# E6: python with uv lockfile and a declared ruff dependency -> uv run commands
d="$FIX/e6"; mkdir -p "$d"
cat > "$d/pyproject.toml" <<'EOF'
[project]
name = "e6"
version = "0.1.0"
dependencies = ["ruff"]

[tool.ruff]
line-length = 100
EOF
touch "$d/uv.lock"
out="$(detect "$d")"
assert_contains "uv.lock -> PM=uv"           "$out" $'\nPM=uv'
assert_contains "uv -> PM_RUN=uv run"        "$out" "PM_RUN=uv run"
assert_contains "declared ruff -> runnable LINT via uv run" "$out" "LINT=uv run ruff check"

# E7: bare requirements.txt — pip has no runner; none may be invented
d="$FIX/e7"; mkdir -p "$d"
printf 'requests==2.31.0\n' > "$d/requirements.txt"
out="$(detect "$d")"
assert_contains "requirements.txt alone -> PM=pip" "$out" $'\nPM=pip'
assert_not_contains "pip -> no PM_RUN" "$out" "PM_RUN="

finish
