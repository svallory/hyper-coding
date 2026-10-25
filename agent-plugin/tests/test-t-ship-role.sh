#!/usr/bin/env bash
# Row T (ship-role) — role launch profiles for claude and pi. HOME is a temp
# dir (helpers.sh), so the real ~/.claude and ~/.pi are never read or written.

REAL_HOME="$HOME"
_mt() { # mtime-ish fingerprint of a path, or "absent"
  if [[ -e "$1" ]]; then stat -c '%Y %s' "$1" 2>/dev/null || stat -f '%m %z' "$1"; else echo absent; fi
}
REAL_BEFORE="$(_mt "$REAL_HOME/.claude/settings.json") $(_mt "$REAL_HOME/.cache/hyper")"

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

ROLE="$SCRIPTS_DIR/ship/ship-role"

SPACE="$FIX/proj"
mkdir -p "$SPACE/.hyper" "$HOME/.claude"
export SHIP_SPACE_ROOT="$SPACE"
PROJECT="$SPACE/.hyper/ship.yml"
USER_CFG="$HOME/.config/hyper/ship.yml"
mkdir -p "$HOME/.config/hyper"
if command -v sha256sum >/dev/null 2>&1; then _h="$(printf '%s' "$SPACE" | sha256sum)"; else _h="$(printf '%s' "$SPACE" | shasum -a 256)"; fi
OUTDIR="$HOME/.cache/hyper/roles/proj-${_h:0:8}"
CWD="$FIX/cwd"; mkdir -p "$CWD"

# Fixture host settings: a mix of enabled and disabled plugins and other keys.
cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "model": "opus",
  "statusLine": {"type": "command", "command": "echo hi"},
  "enabledPlugins": {
    "hyper@tutor": true,
    "beads@beads-marketplace": true,
    "papiro@tutor": true,
    "gopls-lsp@claude-plugins-official": true,
    "playwright@claude-plugins-official": true,
    "off-already@tutor": false
  }
}
JSON
HS="$HOME/.claude/settings.json"

role() { (cd "$CWD" && bash "$ROLE" "$@" 2>/dev/null); }
role_rc() { (cd "$CWD" && bash "$ROLE" "$@" >/dev/null 2>&1); echo $?; }
# shellcheck disable=SC2069
role_err() { (cd "$CWD" && bash "$ROLE" "$@" 2>&1 >/dev/null); }
plug() { jq -r --arg k "$2" '.enabledPlugins[$k]' "$OUTDIR/$1.json"; }

# C1: lead keeps hyper, beads, papiro; the rest is false ----------------------
out="$(role lead --harness claude)"
assert_eq "lead args: settings + strict mcp, no AskUserQuestion block" \
  "--settings $OUTDIR/lead.json --strict-mcp-config" "$out"
assert_eq "lead keeps hyper" true "$(plug lead hyper@tutor)"
assert_eq "lead keeps beads" true "$(plug lead beads@beads-marketplace)"
assert_eq "lead keeps papiro" true "$(plug lead papiro@tutor)"
assert_eq "lead switches gopls-lsp off" false "$(plug lead gopls-lsp@claude-plugins-official)"
assert_eq "lead switches playwright off" false "$(plug lead playwright@claude-plugins-official)"
assert_eq "an already-off plugin stays off" false "$(plug lead off-already@tutor)"
assert_eq "profile holds only enabledPlugins, env and statusLine (no model)" '["enabledPlugins","env","statusLine"]' \
  "$(jq -c 'keys' "$OUTDIR/lead.json")"
assert_eq "same plugin keys as the host" \
  "$(jq -cS '.enabledPlugins | keys' "$HS")" "$(jq -cS '.enabledPlugins | keys' "$OUTDIR/lead.json")"

# C2: non-lead roles disable everything and block AskUserQuestion --------------
for r in dev verify review spec; do
  out="$(role "$r" --harness claude)"
  assert_eq "$r args carry the AskUserQuestion block" \
    "--settings $OUTDIR/$r.json --strict-mcp-config --disallowedTools=AskUserQuestion" "$out"
  assert_eq "$r: no plugin enabled by default" 0 \
    "$(jq '[.enabledPlugins[] | select(. == true)] | length' "$OUTDIR/$r.json")"
done
# The flag is a single token, so a following prompt is not swallowed.
cat > "$FIX/claude-stub" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_OUT"
STUB
chmod +x "$FIX/claude-stub"
export STUB_OUT="$FIX/stub.out"
# shellcheck disable=SC2046
(cd "$CWD" && "$FIX/claude-stub" $(bash "$ROLE" dev --harness claude 2>/dev/null) "the prompt")
assert_eq "the prompt arrives as the last argument" "the prompt" "$(tail -n 1 "$STUB_OUT")"
assert_eq "AskUserQuestion is one token, directly after the flag" "--disallowedTools=AskUserQuestion" \
  "$(tail -n 2 "$STUB_OUT" | head -n 1)"
assert_eq "lead output never mentions disallowedTools" 0 \
  "$(role lead --harness claude | grep -c disallowedTools)"

# C3: a plugin key from a new install comes out false ---------------------------
jq '.enabledPlugins["brand-new@somewhere"] = true' "$HS" > "$HS.new" && mv "$HS.new" "$HS"
role lead --harness claude >/dev/null
assert_eq "new install is present and false" false "$(plug lead brand-new@somewhere)"
assert_eq "keep list still honoured after the new install" true "$(plug lead hyper@tutor)"

# C4: project override replaces the default keep list ---------------------------
printf 'roles:\n  dev:\n    plugins_keep: [gopls-lsp]\n  lead:\n    plugins_keep: [papiro]\n' > "$PROJECT"
role dev --harness claude >/dev/null
role lead --harness claude >/dev/null
assert_eq "dev override keeps gopls-lsp" true "$(plug dev gopls-lsp@claude-plugins-official)"
assert_eq "dev override leaves others off" false "$(plug dev hyper@tutor)"
assert_eq "lead override replaces (not merges) the list: hyper off" false "$(plug lead hyper@tutor)"
assert_eq "lead override keeps papiro" true "$(plug lead papiro@tutor)"
printf 'roles:\n  dev:\n    plugins_keep: ["gopls-lsp@claude-plugins-official"]\n' > "$PROJECT"
role dev --harness claude >/dev/null
assert_eq "a full name@marketplace keep entry matches" true "$(plug dev gopls-lsp@claude-plugins-official)"
assert_eq "a full-key entry does not match other marketplaces' keys" false "$(plug dev hyper@tutor)"
rm -f "$PROJECT"
printf 'roles:\n  review:\n    plugins_keep: [playwright]\n' > "$USER_CFG"
role review --harness claude >/dev/null
assert_eq "user config layer overrides the default" true "$(plug review playwright@claude-plugins-official)"
rm -f "$USER_CFG"

# C6: statusLine is the quota tap wrapping the host's command ---------------------
TAP="$SCRIPTS_DIR/ship/ship-quota-tap"
role dev --harness claude >/dev/null
assert_eq "statusLine is a command" command "$(jq -r .statusLine.type "$OUTDIR/dev.json")"
assert_eq "statusLine runs the tap, wrapping the host command" "'$TAP' --original 'echo hi'" \
  "$(jq -r .statusLine.command "$OUTDIR/dev.json")"
for r in lead verify review spec; do
  role "$r" --harness claude >/dev/null
  assert_contains "$r: statusLine runs the tap" "$(jq -r .statusLine.command "$OUTDIR/$r.json")" "$TAP"
done
# The command string works as written, quotes in the original included.
jq '.statusLine = {"type":"command","command":"printf \"%s|it'"'"'s\" \"$(cat)\"","padding":3}' "$HS" > "$HS.new" && mv "$HS.new" "$HS"
role dev --harness claude >/dev/null
assert_eq "other statusLine keys of the host are kept" 3 "$(jq -r .statusLine.padding "$OUTDIR/dev.json")"
assert_eq "the generated command pipes stdin to a quoted original" '{"a":1}|it'"'"'s' \
  "$(printf '%s' '{"a":1}' | SHIP_QUOTA_DIR="$FIX/quota-role" sh -c "$(jq -r .statusLine.command "$OUTDIR/dev.json")")"
# A project statusLine wins over the host's; no statusLine anywhere = the tap alone.
mkdir -p "$CWD/.claude"
printf '{"statusLine":{"type":"command","command":"echo project"}}\n' > "$CWD/.claude/settings.json"
role dev --harness claude >/dev/null
assert_eq "the project layer's statusLine is the one wrapped" "'$TAP' --original 'echo project'" \
  "$(jq -r .statusLine.command "$OUTDIR/dev.json")"
rm -f "$CWD/.claude/settings.json"
jq 'del(.statusLine)' "$HS" > "$HS.new" && mv "$HS.new" "$HS"
role dev --harness claude >/dev/null
assert_eq "no host statusLine: the tap runs alone" "'$TAP'" "$(jq -r .statusLine.command "$OUTDIR/dev.json")"

# C5: --host-settings, missing/invalid host settings ----------------------------
printf '{"enabledPlugins":{"x@y":true,"hyper@z":true}}\n' > "$FIX/other.json"
role lead --harness claude --host-settings "$FIX/other.json" >/dev/null
assert_eq "--host-settings is used instead of ~/.claude" '{"x@y":false,"hyper@z":true}' \
  "$(jq -c '.enabledPlugins' "$OUTDIR/lead.json")"
assert_eq "explicit missing host settings exits 1" 1 "$(role_rc lead --harness claude --host-settings "$FIX/nope.json")"
printf 'not json' > "$FIX/bad.json"
assert_eq "invalid host settings exits 1" 1 "$(role_rc lead --harness claude --host-settings "$FIX/bad.json")"
printf '{"model":"opus"}\n' > "$FIX/noplugins.json"
role lead --harness claude --host-settings "$FIX/noplugins.json" >/dev/null
assert_eq "host settings without enabledPlugins give an empty map" '{}' "$(jq -c '.enabledPlugins' "$OUTDIR/lead.json")"
mv "$HS" "$HS.bak"
assert_eq "absent default ~/.claude/settings.json gives an empty map, exit 0" 0 "$(role_rc lead --harness claude)"
mv "$HS.bak" "$HS"

# C6: nothing leaks outside the temp HOME; no temp files left -------------------
assert_eq "no stray temp files in the roles dir" 0 "$(find "$OUTDIR" -name '.*' -type f | wc -l | tr -d ' ')"

# C7: usage errors ----------------------------------------------------------------
assert_eq "no role: exit 2" 2 "$(role_rc --harness claude)"
assert_eq "unknown role: exit 2" 2 "$(role_rc nope --harness claude)"
assert_eq "no harness: exit 2" 2 "$(role_rc dev)"
assert_eq "unknown harness: exit 2" 2 "$(role_rc dev --harness gemini)"
assert_eq "lead on pi: exit 2" 2 "$(role_rc lead --harness pi)"
assert_eq "unknown flag: exit 2" 2 "$(role_rc dev --harness claude --bogus)"

# C8: pi ------------------------------------------------------------------------------
mkskill() { mkdir -p "$1/$2"; printf -- '---\nname: %s\n---\n' "$2" > "$1/$2/SKILL.md"; }
AG="$HOME/.agents/skills"; CL="$HOME/.claude/skills"
SPW="$HOME/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.0/skills"
mkskill "$AG" affected-tests; mkskill "$AG" rci
mkskill "$CL" code-review; mkskill "$CL" arch-review
mkskill "$SPW" receiving-code-review; mkskill "$SPW" systematic-debugging
mkskill "$SPW" verification-before-completion
# an older superpowers version must lose to the newest
OLD="$HOME/.claude/plugins/cache/claude-plugins-official/superpowers/4.9.0/skills"
mkskill "$OLD" verification-before-completion
NPM="$HOME/.pi/agent/npm/node_modules"
mkdir -p "$NPM/pi-lens/ext"
printf '{"pi":{"extensions":["./ext/main.ts","./ext/gone.ts"]}}\n' > "$NPM/pi-lens/package.json"
: > "$NPM/pi-lens/ext/main.ts"

out="$(role dev --harness pi)"
exp="-ne -ns -np --no-mcp"
exp="$exp --skill $AG/affected-tests --skill $AG/rci"
exp="$exp --skill $SPW/receiving-code-review --skill $SPW/systematic-debugging --skill $SPW/verification-before-completion"
exp="$exp -e $NPM/pi-lens/ext/main.ts --no-autofix --no-tests --no-opengrep --exclude-tools ask_user"
assert_eq "dev pi args (skills across lookup dirs, extension entry that exists, flags)" "$exp" "$out"

out="$(role review --harness pi)"
assert_eq "review pi args" \
  "-ne -ns -np --no-mcp --skill $CL/code-review --skill $CL/arch-review --exclude-tools ask_user" "$out"
out="$(role spec --harness pi)"
assert_eq "spec pi args: base flags only" "-ne -ns -np --no-mcp --exclude-tools ask_user" "$out"
out="$(role verify --harness pi)"
assert_eq "verify pi args pick the newest superpowers dir" \
  "-ne -ns -np --no-mcp --skill $SPW/verification-before-completion --exclude-tools ask_user" "$out"
assert_eq "pi output has no claude-only flags" 0 "$(role dev --harness pi | grep -c -e '--settings\|AskUserQuestion')"

# C9: a missing pi skill errors (exit 1, names the skill, prints nothing) ----------------
rm -rf "$CL/arch-review"
assert_eq "missing skill: exit 1" 1 "$(role_rc review --harness pi)"
assert_contains "missing skill is named" "$(role_err review --harness pi)" "arch-review"
assert_eq "missing skill: nothing on stdout" "" "$(role review --harness pi)"
mkskill "$CL" arch-review

# C10: project overrides for pi skills and extensions ---------------------------------
cat > "$PROJECT" <<'YAML'
roles:
  spec:
    pi_skills: [rci]
    pi_extensions:
      - {name: pi-lens, flags: [--only-this]}
      - {name: "/abs/missing.ts", flags: [--dropped]}
YAML
out="$(role spec --harness pi)"
assert_eq "unresolved extension: exit 1" 1 "$(role_rc spec --harness pi)"
assert_contains "unresolved extension is named" "$(role_err spec --harness pi)" "/abs/missing.ts"
assert_eq "unresolved extension: nothing on stdout" "" "$(role spec --harness pi)"
cat > "$PROJECT" <<'YAML'
roles:
  spec:
    pi_skills: [rci]
    pi_extensions:
      - {name: pi-lens, flags: [--only-this]}
YAML
assert_eq "override replaces skills and extensions" \
  "-ne -ns -np --no-mcp --skill $AG/rci -e $NPM/pi-lens/ext/main.ts --only-this --exclude-tools ask_user" "$(role spec --harness pi)"
printf 'roles:\n  spec:\n    pi_extensions: [{name: nopkg, flags: []}]\n' > "$PROJECT"
assert_eq "an uninstalled extension package: exit 1" 1 "$(role_rc spec --harness pi)"
assert_contains "uninstalled extension is named" "$(role_err spec --harness pi)" "nopkg"
: > "$FIX/ext.ts"
printf 'roles:\n  spec:\n    pi_extensions:\n      - {name: "%s", flags: []}\n' "$FIX/ext.ts" > "$PROJECT"
assert_eq "absolute extension path resolves" \
  "-ne -ns -np --no-mcp -e $FIX/ext.ts --exclude-tools ask_user" "$(role spec --harness pi)"
printf 'roles:\n  dev:\n    pi_skills: []\n    pi_extensions: []\n' > "$PROJECT"
assert_eq "empty lists give the base args" "-ne -ns -np --no-mcp --exclude-tools ask_user" "$(role dev --harness pi)"
rm -f "$PROJECT"

# C11: config errors and space root ---------------------------------------------------------
printf 'roles: [not, a, map\n' > "$PROJECT"
assert_eq "malformed ship.yml: exit 1" 1 "$(role_rc dev --harness claude)"
rm -f "$PROJECT"
assert_eq "SHIP_SPACE_ROOT not a directory: exit 1" 1 "$(SHIP_SPACE_ROOT="$FIX/missing-dir" role_rc dev --harness claude)"
cp "$HS" "$FIX/hs.keep"

# C12: works through a symlink on PATH -------------------------------------------------------
mkdir -p "$FIX/bin"
ln -s "$ROLE" "$FIX/bin/ship-role"
assert_eq "symlinked ship-role works" \
  "--settings $OUTDIR/lead.json --strict-mcp-config" "$(PATH="$FIX/bin:$PATH" ship-role lead --harness claude 2>/dev/null)"
ln -s "$FIX/bin/ship-role" "$FIX/bin/ship-role2"
assert_eq "chained symlink works" 0 "$(PATH="$FIX/bin:$PATH" ship-role2 lead --harness claude >/dev/null 2>&1; echo $?)"

# C14: a kept plugin the host has off stays off ------------------------------------------
printf '{"enabledPlugins":{"hyper@tutor":false,"beads@beads-marketplace":true}}\n' > "$FIX/off.json"
role lead --harness claude --host-settings "$FIX/off.json" >/dev/null
assert_eq "kept but host-off plugin stays false" false "$(plug lead hyper@tutor)"
assert_eq "kept and host-on plugin is true" true "$(plug lead beads@beads-marketplace)"

# C15: non-list role values are errors, naming the key -----------------------------------
printf 'roles:\n  dev:\n    pi_skills: rci\n' > "$PROJECT"
assert_eq "pi_skills as a string: exit 1" 1 "$(role_rc dev --harness pi)"
assert_contains "names roles.dev.pi_skills" "$(role_err dev --harness pi)" "roles.dev.pi_skills"
printf 'roles:\n  dev:\n    pi_skills: []\n    pi_extensions: {name: pi-lens}\n' > "$PROJECT"
assert_eq "pi_extensions as a map: exit 1" 1 "$(role_rc dev --harness pi)"
assert_contains "names roles.dev.pi_extensions" "$(role_err dev --harness pi)" "roles.dev.pi_extensions"
printf 'roles:\n  dev:\n    pi_skills: [1]\n' > "$PROJECT"
assert_eq "pi_skills with a non-string entry: exit 1" 1 "$(role_rc dev --harness pi)"
printf 'roles:\n  dev:\n    plugins_keep: hyper\n' > "$PROJECT"
assert_eq "plugins_keep as a string: exit 1" 1 "$(role_rc dev --harness claude)"
rm -f "$PROJECT"

# C16: paths with whitespace or glob characters are rejected -------------------------------
mkskill "$HOME/.agents/skills" "odd name"
printf 'roles:\n  dev:\n    pi_skills: ["odd name"]\n    pi_extensions: []\n' > "$PROJECT"
assert_eq "skill path with a space: exit 1" 1 "$(role_rc dev --harness pi)"
assert_contains "names the path" "$(role_err dev --harness pi)" "odd name"
rm -rf "$HOME/.agents/skills/odd name"
mkskill "$HOME/.agents/skills" "star*"
printf 'roles:\n  dev:\n    pi_skills: ["star*"]\n    pi_extensions: []\n' > "$PROJECT"
assert_eq "skill path with a glob char: exit 1" 1 "$(role_rc dev --harness pi)"
rm -rf "$HOME/.agents/skills/star*"
printf 'x' > "$FIX/with space.ts"
printf 'roles:\n  dev:\n    pi_skills: []\n    pi_extensions: [{name: "%s", flags: []}]\n' "$FIX/with space.ts" > "$PROJECT"
assert_eq "extension path with a space: exit 1" 1 "$(role_rc dev --harness pi)"
rm -f "$PROJECT"

# C17: CLAUDE_CONFIG_DIR is the default host settings location ------------------------------
mkdir -p "$FIX/cc"
printf '{"enabledPlugins":{"cfgdir@m":true}}\n' > "$FIX/cc/settings.json"
(cd "$CWD" && CLAUDE_CONFIG_DIR="$FIX/cc" bash "$ROLE" lead --harness claude >/dev/null 2>&1)
assert_eq "CLAUDE_CONFIG_DIR/settings.json is read" '["cfgdir@m"]' "$(jq -c '.enabledPlugins | keys' "$OUTDIR/lead.json")"

# C18: project layers are folded in; PLUGIN_DIRS is blanked ---------------------------------
mkdir -p "$CWD/.claude"
printf '{"enabledPlugins":{"proj-only@m":true,"hyper@tutor":true}}\n' > "$CWD/.claude/settings.json"
printf '{"enabledPlugins":{"local-only@m":true,"proj-only@m":false},"env":{"CLAUDE_CODE_PLUGIN_DIRS":"/some/dir"}}\n' > "$CWD/.claude/settings.local.json"
role lead --harness claude >/dev/null
assert_eq "project-layer key is present and false when not kept" false "$(plug lead local-only@m)"
assert_eq "later layer wins (proj-only turned off by settings.local)" false "$(plug lead proj-only@m)"
assert_eq "kept plugin enabled in a project layer is true" true "$(plug lead hyper@tutor)"
assert_eq "host keys are still there" false "$(plug lead playwright@claude-plugins-official)"
assert_eq "CLAUDE_CODE_PLUGIN_DIRS blanked" '""' "$(jq -c '.env.CLAUDE_CODE_PLUGIN_DIRS' "$OUTDIR/lead.json")"
rm -rf "$CWD/.claude"
role lead --harness claude >/dev/null
assert_eq "PLUGIN_DIRS blanked even when no layer sets it" '""' "$(jq -c '.env.CLAUDE_CODE_PLUGIN_DIRS' "$OUTDIR/lead.json")"
printf '{"env":{"CLAUDE_CODE_PLUGIN_DIRS":"/d"}}\n' > "$FIX/envhost.json"
role lead --harness claude --host-settings "$FIX/envhost.json" >/dev/null
assert_eq "host layer PLUGIN_DIRS also blanked" '""' "$(jq -c '.env.CLAUDE_CODE_PLUGIN_DIRS' "$OUTDIR/lead.json")"

# C19: the cache dir is keyed by basename + hash of the space root ----------------------------
mkdir -p "$FIX/other/proj"
role lead --harness claude >/dev/null
(cd "$CWD" && SHIP_SPACE_ROOT="$FIX/other/proj" bash "$ROLE" lead --harness claude >/dev/null 2>&1)
assert_eq "two spaces sharing a basename get two cache dirs" 2 "$(find "$HOME/.cache/hyper/roles" -maxdepth 1 -name 'proj-*' | wc -l | tr -d ' ')"
assert_eq "cache dir name is <basename>-<8 hex>" 1 "$(basename "$OUTDIR" | grep -Ec '^proj-[0-9a-f]{8}$')"

# C20: --cwd picks the project layers; flags with whitespace are rejected; --help is whole --------
mkdir -p "$FIX/wt/.claude"
printf '{"enabledPlugins":{"wt-only@m":true}}\n' > "$FIX/wt/.claude/settings.json"
(cd "$CWD" && bash "$ROLE" lead --harness claude --cwd "$FIX/wt" >/dev/null 2>&1)
assert_eq "--cwd layer is read" false "$(plug lead wt-only@m)"
role lead --harness claude >/dev/null
assert_eq "without --cwd the layer is not read" null "$(plug lead wt-only@m)"
assert_eq "--cwd without a value: exit 2" 2 "$(role_rc lead --harness claude --cwd)"
cat > "$PROJECT" <<'YAML'
roles:
  spec:
    pi_skills: []
    pi_extensions:
      - {name: pi-lens, flags: ["--a b"]}
YAML
assert_eq "extension flag with whitespace: exit 1" 1 "$(role_rc spec --harness pi)"
assert_contains "names the flag" "$(role_err spec --harness pi)" "--a b"
rm -f "$PROJECT"
help_out="$(role --help)"
assert_contains "--help includes the pi docs" "$help_out" "--exclude-tools ask_user"
assert_contains "--help includes the exit codes" "$help_out" "Exit codes"
assert_contains "--help documents --cwd" "$help_out" "--cwd"

# C13: the real home is untouched -----------------------------------------------------------------
case "$HOME" in "$FIX"/*) pass "HOME is inside the fixture dir" ;; *) fail "HOME escaped the fixture dir: $HOME" ;; esac
REAL_AFTER="$(_mt "$REAL_HOME/.claude/settings.json") $(_mt "$REAL_HOME/.cache/hyper")"
assert_eq "the real ~/.claude/settings.json and ~/.cache/hyper are unchanged" "$REAL_BEFORE" "$REAL_AFTER"

finish
