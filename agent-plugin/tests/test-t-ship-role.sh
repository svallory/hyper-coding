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

# Fixture host settings: enabled and disabled plugins (a new install, a same-name
# plugin from another marketplace), a quoted statusLine with padding, a host
# PLUGIN_DIRS. One lead spawn over it carries several former single-case spawns.
cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "model": "opus",
  "statusLine": {"type": "command", "command": "printf \"%s|it's\" \"$(cat)\"", "padding": 3},
  "env": {"CLAUDE_CODE_PLUGIN_DIRS": "/host/dir"},
  "enabledPlugins": {
    "hyper@tutor": true,
    "beads@beads-marketplace": true,
    "papiro@tutor": true,
    "gopls-lsp@claude-plugins-official": true,
    "playwright@claude-plugins-official": true,
    "off-already@tutor": false,
    "brand-new@somewhere": true,
    "gopls-lsp@other-market": true
  }
}
JSON
HS="$HOME/.claude/settings.json"

# Config preload: ship-role loads the merged config (3 yq + ~20 jq forks) on every
# spawn. The merged config is a function of the two layer files only, so it is
# loaded once per distinct (project, user) content and handed to the spawns via
# SHIP_CONFIG_JSON/SHIP_CONFIG_LAYERS, the cache lib.sh already honours. A layer
# set that fails to load is not preloaded, so ship-role reports the error itself.
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
mkdir -p "$FIX/cfgcache"
_PF=""
_preload() {
  local k
  k="$({ echo P; cat "$PROJECT"; echo U; cat "$USER_CFG"; } 2>/dev/null | cksum | tr -d ' ')"
  _PF="$FIX/cfgcache/$k"
  [[ -e "$_PF.json" || -e "$_PF.fail" ]] && return 0
  if (
    unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
    ship_config_load >/dev/null 2>&1 \
      && printf '%s' "$SHIP_CONFIG_JSON" > "$_PF.json" && printf '%s' "$SHIP_CONFIG_LAYERS" > "$_PF.layers"
  ); then :; else : > "$_PF.fail"; fi
}
# rb <args...> — run ship-role from $CWD with the config preloaded.
rb() {
  _preload
  if [[ -e "$_PF.json" ]]; then
    (cd "$CWD" && SHIP_CONFIG_JSON="$(<"$_PF.json")" SHIP_CONFIG_LAYERS="$(<"$_PF.layers")" bash "$ROLE" "$@")
  else
    (cd "$CWD" && bash "$ROLE" "$@")
  fi
}
role() { rb "$@" 2>/dev/null; }
role_rc() { rb "$@" >/dev/null 2>&1; echo $?; }
# shellcheck disable=SC2069
role_err() { rb "$@" 2>&1 >/dev/null; }

plug() { jq -r --arg k "$2" '.enabledPlugins[$k]' "$OUTDIR/$1.json"; }
# run3 <args...> — one spawn; sets R (exit code), O (stdout), E (stderr).
run3() { rb "$@" >"$FIX/run3.o" 2>"$FIX/run3.e"; R=$?; O="$(<"$FIX/run3.o")"; E="$(<"$FIX/run3.e")"; }
TAP="$SCRIPTS_DIR/ship/ship-quota-tap"

# C1: lead keeps hyper, beads, papiro; the rest is false (one spawn, many keys) ----
out="$(role lead --harness claude)"
assert_eq "lead args: settings + strict mcp, no AskUserQuestion block" \
  "--settings $OUTDIR/lead.json --strict-mcp-config" "$out"
assert_not_contains "lead output never mentions disallowedTools" "$out" disallowedTools
assert_eq "lead keeps hyper" true "$(plug lead hyper@tutor)"
assert_eq "lead keeps beads" true "$(plug lead beads@beads-marketplace)"
assert_eq "lead keeps papiro" true "$(plug lead papiro@tutor)"
assert_eq "lead switches gopls-lsp off" false "$(plug lead gopls-lsp@claude-plugins-official)"
assert_eq "lead switches playwright off" false "$(plug lead playwright@claude-plugins-official)"
assert_eq "an already-off plugin stays off" false "$(plug lead off-already@tutor)"
assert_eq "a plugin from a new install is present and false" false "$(plug lead brand-new@somewhere)"
assert_eq "profile holds only enabledPlugins, env and statusLine (no model)" '["enabledPlugins","env","statusLine"]' \
  "$(jq -c 'keys' "$OUTDIR/lead.json")"
assert_eq "same plugin keys as the host" \
  "$(jq -cS '.enabledPlugins | keys' "$HS")" "$(jq -cS '.enabledPlugins | keys' "$OUTDIR/lead.json")"
assert_eq "CLAUDE_CODE_PLUGIN_DIRS blanked though the host sets it" '""' "$(jq -c '.env.CLAUDE_CODE_PLUGIN_DIRS' "$OUTDIR/lead.json")"
# C6: statusLine is the quota tap wrapping the host's command
assert_eq "statusLine is a command" command "$(jq -r .statusLine.type "$OUTDIR/lead.json")"
assert_contains "statusLine runs the tap, wrapping the host command" "$(jq -r .statusLine.command "$OUTDIR/lead.json")" "'$TAP' --original "
assert_eq "other statusLine keys of the host are kept" 3 "$(jq -r .statusLine.padding "$OUTDIR/lead.json")"
assert_eq "the generated command pipes stdin to a quoted original (quotes survive)" '{"a":1}|it'"'"'s' \
  "$(printf '%s' '{"a":1}' | SHIP_QUOTA_DIR="$FIX/quota-role" sh -c "$(jq -r .statusLine.command "$OUTDIR/lead.json")")"

# C2: non-lead roles disable everything and block AskUserQuestion --------------
for r in dev verify review spec; do
  out="$(role "$r" --harness claude)"
  assert_eq "$r args carry the AskUserQuestion block" \
    "--settings $OUTDIR/$r.json --strict-mcp-config --disallowedTools=AskUserQuestion" "$out"
  assert_eq "$r: no plugin enabled by default" 0 \
    "$(jq '[.enabledPlugins[] | select(. == true)] | length' "$OUTDIR/$r.json")"
  assert_contains "$r: statusLine runs the tap" "$(jq -r .statusLine.command "$OUTDIR/$r.json")" "$TAP"
done
# The flag is a single token, so a following prompt is not swallowed.
cat > "$FIX/claude-stub" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_OUT"
STUB
chmod +x "$FIX/claude-stub"
export STUB_OUT="$FIX/stub.out"
# shellcheck disable=SC2046
"$FIX/claude-stub" $(role dev --harness claude) "the prompt"
assert_eq "the prompt arrives as the last argument" "the prompt" "$(tail -n 1 "$STUB_OUT")"
assert_eq "AskUserQuestion is one token, directly after the flag" "--disallowedTools=AskUserQuestion" \
  "$(tail -n 2 "$STUB_OUT" | head -n 1)"

# C4: project override replaces the default keep list (bare and full-key forms) ----
printf 'roles:\n  dev:\n    plugins_keep: ["gopls-lsp@claude-plugins-official"]\n  lead:\n    plugins_keep: [papiro]\n' > "$PROJECT"
role dev --harness claude >/dev/null
role lead --harness claude >/dev/null
assert_eq "a full name@marketplace keep entry matches" true "$(plug dev gopls-lsp@claude-plugins-official)"
assert_eq "a full-key entry does not match the same name from another marketplace" false "$(plug dev gopls-lsp@other-market)"
assert_eq "dev override leaves others off" false "$(plug dev hyper@tutor)"
assert_eq "lead override replaces (not merges) the list: hyper off" false "$(plug lead hyper@tutor)"
assert_eq "lead override keeps papiro (bare name)" true "$(plug lead papiro@tutor)"
rm -f "$PROJECT"

# C5: --host-settings, missing/invalid host settings ----------------------------
printf '{"enabledPlugins":{"x@y":true,"hyper@z":true,"hyper@tutor":false,"beads@beads-marketplace":true}}\n' > "$FIX/other.json"
role lead --harness claude --host-settings "$FIX/other.json" >/dev/null
assert_eq "--host-settings is used instead of ~/.claude; kept-but-host-off stays false, kept-and-on is true" \
  '{"beads@beads-marketplace":true,"hyper@tutor":false,"hyper@z":true,"x@y":false}' \
  "$(jq -cS '.enabledPlugins' "$OUTDIR/lead.json")"
assert_eq "explicit missing host settings exits 1" 1 "$(role_rc lead --harness claude --host-settings "$FIX/nope.json")"
printf 'not json' > "$FIX/bad.json"
assert_eq "invalid host settings exits 1" 1 "$(role_rc lead --harness claude --host-settings "$FIX/bad.json")"
printf '{"model":"opus"}\n' > "$FIX/noplugins.json"
role lead --harness claude --host-settings "$FIX/noplugins.json" >/dev/null
assert_eq "host settings without enabledPlugins give an empty map" '{}' "$(jq -c '.enabledPlugins' "$OUTDIR/lead.json")"
assert_eq "no host statusLine: the tap runs alone" "'$TAP'" "$(jq -r .statusLine.command "$OUTDIR/lead.json")"
assert_eq "PLUGIN_DIRS blanked even when no layer sets it" '""' "$(jq -c '.env.CLAUDE_CODE_PLUGIN_DIRS' "$OUTDIR/lead.json")"
mv "$HS" "$HS.bak"
assert_eq "absent default ~/.claude/settings.json gives an empty map, exit 0" 0 "$(role_rc lead --harness claude)"
mv "$HS.bak" "$HS"
# C17: CLAUDE_CONFIG_DIR is the default host settings location
mkdir -p "$FIX/cc"
printf '{"enabledPlugins":{"cfgdir@m":true}}\n' > "$FIX/cc/settings.json"
CLAUDE_CONFIG_DIR="$FIX/cc" role lead --harness claude >/dev/null
assert_eq "CLAUDE_CONFIG_DIR/settings.json is read" '["cfgdir@m"]' "$(jq -c '.enabledPlugins | keys' "$OUTDIR/lead.json")"

# C6: nothing leaks outside the temp HOME; no temp files left -------------------
assert_eq "no stray temp files in the roles dir" 0 "$(find "$OUTDIR" -name '.*' -type f | wc -l | tr -d ' ')"

# C7: usage errors ----------------------------------------------------------------
assert_eq "no role: exit 2" 2 "$(role_rc --harness claude)"
assert_eq "unknown flag: exit 2" 2 "$(role_rc dev --harness claude --bogus)"
assert_eq "lead on pi: exit 2" 2 "$(role_rc lead --harness pi)"

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
assert_eq "dev pi args (skills across lookup dirs, newest superpowers, extension entry that exists, flags)" "$exp" "$out"
assert_not_contains "pi output has no --settings" "$out" "--settings"
assert_not_contains "pi output has no AskUserQuestion" "$out" "AskUserQuestion"

out="$(role review --harness pi)"
assert_eq "review pi args" \
  "-ne -ns -np --no-mcp --skill $CL/code-review --skill $CL/arch-review --exclude-tools ask_user" "$out"
out="$(role spec --harness pi)"
assert_eq "spec pi args (defaults hold no skills or extensions): base flags only" "-ne -ns -np --no-mcp --exclude-tools ask_user" "$out"

# C9: a missing pi skill errors (exit 1, names the skill, prints nothing) ----------------
rm -rf "$CL/arch-review"
run3 review --harness pi
assert_eq "missing skill: exit 1" 1 "$R"
assert_contains "missing skill is named" "$E" "arch-review"
assert_eq "missing skill: nothing on stdout" "" "$O"
mkskill "$CL" arch-review

# C10: project overrides for pi skills and extensions ---------------------------------
cat > "$PROJECT" <<'YAML'
roles:
  spec:
    pi_skills: [rci]
    pi_extensions:
      - {name: pi-lens, flags: [--only-this]}
      - {name: "/abs/missing.ts", flags: [--dropped]}
      - {name: nopkg, flags: []}
YAML
run3 spec --harness pi
assert_eq "unresolved extensions: exit 1" 1 "$R"
assert_contains "an unresolved absolute extension is named" "$E" "/abs/missing.ts"
assert_contains "an uninstalled extension package is named" "$E" "nopkg"
assert_eq "unresolved extensions: nothing on stdout" "" "$O"
: > "$FIX/ext.ts"
cat > "$PROJECT" <<YAML
roles:
  spec:
    pi_skills: [rci]
    pi_extensions:
      - {name: pi-lens, flags: [--only-this]}
      - {name: "$FIX/ext.ts", flags: []}
YAML
assert_eq "override replaces skills and extensions; an absolute extension path resolves" \
  "-ne -ns -np --no-mcp --skill $AG/rci -e $NPM/pi-lens/ext/main.ts --only-this -e $FIX/ext.ts --exclude-tools ask_user" "$(role spec --harness pi)"
printf 'roles:\n  dev:\n    pi_skills: []\n    pi_extensions: []\n' > "$PROJECT"
assert_eq "empty lists give the base args" "-ne -ns -np --no-mcp --exclude-tools ask_user" "$(role dev --harness pi)"
rm -f "$PROJECT"

# C11: standalone (no preload): ship-role loads the layers itself; a malformed ship.yml is exit 1
printf 'roles: [not, a, map\n' > "$PROJECT"
rc=0; err="$(cd "$CWD" && bash "$ROLE" dev --harness claude 2>&1 >/dev/null)" || rc=$?
assert_eq "standalone, malformed ship.yml: exit 1" 1 "$rc"
assert_contains "standalone, malformed ship.yml: names the file" "$err" "$PROJECT"
rm -f "$PROJECT"

# C12: works through a (chained) symlink on PATH ---------------------------------------------
mkdir -p "$FIX/bin"
ln -s "$ROLE" "$FIX/bin/ship-role"
ln -s "$FIX/bin/ship-role" "$FIX/bin/ship-role2"
_preload
assert_eq "chained symlinked ship-role works" \
  "--settings $OUTDIR/lead.json --strict-mcp-config" \
  "$(cd "$CWD" && SHIP_CONFIG_JSON="$(<"$_PF.json")" SHIP_CONFIG_LAYERS="$(<"$_PF.layers")" PATH="$FIX/bin:$PATH" ship-role2 lead --harness claude 2>/dev/null)"

# C15: non-list role values are errors, naming the key (one config, one spawn per key) -----
cat > "$PROJECT" <<'YAML'
roles:
  dev: {pi_skills: rci}
  spec: {pi_skills: [], pi_extensions: {name: pi-lens}}
  review: {pi_skills: [1]}
  verify: {plugins_keep: hyper}
YAML
run3 dev --harness pi
assert_eq "pi_skills as a string: exit 1" 1 "$R"
assert_contains "names roles.dev.pi_skills" "$E" "roles.dev.pi_skills"
run3 spec --harness pi
assert_eq "pi_extensions as a map: exit 1" 1 "$R"
assert_contains "names roles.spec.pi_extensions" "$E" "roles.spec.pi_extensions"
run3 review --harness pi
assert_eq "pi_skills with a non-string entry: exit 1" 1 "$R"
assert_contains "names roles.review.pi_skills" "$E" "roles.review.pi_skills"
run3 verify --harness claude
assert_eq "plugins_keep as a string: exit 1" 1 "$R"
assert_contains "names roles.verify.plugins_keep" "$E" "roles.verify.plugins_keep"

# C16: paths with whitespace or glob characters are rejected -------------------------------
mkskill "$HOME/.agents/skills" "odd name"
mkskill "$HOME/.agents/skills" "star*"
printf 'x' > "$FIX/with space.ts"
cat > "$PROJECT" <<YAML
roles:
  dev: {pi_skills: ["odd name"], pi_extensions: []}
  review: {pi_skills: ["star*"], pi_extensions: []}
  spec: {pi_skills: [], pi_extensions: [{name: "$FIX/with space.ts", flags: []}]}
YAML
run3 dev --harness pi
assert_eq "skill path with a space: exit 1" 1 "$R"
assert_contains "names the path" "$E" "odd name"
run3 review --harness pi
assert_eq "skill path with a glob char: exit 1" 1 "$R"
assert_contains "names the glob path" "$E" "star*"
run3 spec --harness pi
assert_eq "extension path with a space: exit 1" 1 "$R"
assert_contains "names the extension path" "$E" "with space.ts"
rm -rf "$HOME/.agents/skills/odd name"
rm -rf "$HOME/.agents/skills/star*"

# C20: flags with whitespace are rejected -------------------------------------------------
cat > "$PROJECT" <<'YAML'
roles:
  spec:
    pi_skills: []
    pi_extensions:
      - {name: pi-lens, flags: ["--a b"]}
YAML
run3 spec --harness pi
assert_eq "extension flag with whitespace: exit 1" 1 "$R"
assert_contains "names the flag" "$E" "--a b"
rm -f "$PROJECT"

# C18: project layers are folded in; PLUGIN_DIRS is blanked; the project statusLine wins ----
mkdir -p "$CWD/.claude"
printf '{"enabledPlugins":{"proj-only@m":true,"hyper@tutor":true},"statusLine":{"type":"command","command":"echo project"}}\n' > "$CWD/.claude/settings.json"
printf '{"enabledPlugins":{"local-only@m":true,"proj-only@m":false},"env":{"CLAUDE_CODE_PLUGIN_DIRS":"/some/dir"}}\n' > "$CWD/.claude/settings.local.json"
role lead --harness claude >/dev/null
assert_eq "project-layer key is present and false when not kept" false "$(plug lead local-only@m)"
assert_eq "later layer wins (proj-only turned off by settings.local)" false "$(plug lead proj-only@m)"
assert_eq "kept plugin enabled in a project layer is true" true "$(plug lead hyper@tutor)"
assert_eq "host keys are still there" false "$(plug lead playwright@claude-plugins-official)"
assert_eq "CLAUDE_CODE_PLUGIN_DIRS blanked" '""' "$(jq -c '.env.CLAUDE_CODE_PLUGIN_DIRS' "$OUTDIR/lead.json")"
assert_eq "the project layer's statusLine is the one wrapped" "'$TAP' --original 'echo project'" \
  "$(jq -r .statusLine.command "$OUTDIR/lead.json")"
rm -rf "$CWD/.claude"

# C19: the cache dir is keyed by basename + hash of the space root ----------------------------
mkdir -p "$FIX/other/proj"
SHIP_SPACE_ROOT="$FIX/other/proj" role lead --harness claude >/dev/null
assert_eq "two spaces sharing a basename get two cache dirs" 2 "$(find "$HOME/.cache/hyper/roles" -maxdepth 1 -name 'proj-*' | wc -l | tr -d ' ')"
assert_eq "cache dir name is <basename>-<8 hex>" 1 "$(basename "$OUTDIR" | grep -Ec '^proj-[0-9a-f]{8}$')"

# C20: --cwd picks the project layers; --help is whole --------------------------------------------
mkdir -p "$FIX/wt/.claude"
printf '{"enabledPlugins":{"wt-only@m":true}}\n' > "$FIX/wt/.claude/settings.json"
rb verify --harness claude --cwd "$FIX/wt" >/dev/null 2>&1
assert_eq "--cwd layer is read" false "$(plug verify wt-only@m)"
role lead --harness claude >/dev/null
assert_eq "without --cwd the layer is not read" null "$(plug lead wt-only@m)"
assert_eq "--cwd without a value: exit 2" 2 "$(role_rc lead --harness claude --cwd)"
help_out="$(role --help)"
assert_contains "--help includes the pi docs" "$help_out" "--exclude-tools ask_user"
assert_contains "--help includes the exit codes" "$help_out" "Exit codes"
assert_contains "--help documents --cwd" "$help_out" "--cwd"

# C13: the real home is untouched -----------------------------------------------------------------
case "$HOME" in "$FIX"/*) pass "HOME is inside the fixture dir" ;; *) fail "HOME escaped the fixture dir: $HOME" ;; esac
REAL_AFTER="$(_mt "$REAL_HOME/.claude/settings.json") $(_mt "$REAL_HOME/.cache/hyper")"
assert_eq "the real ~/.claude/settings.json and ~/.cache/hyper are unchanged" "$REAL_BEFORE" "$REAL_AFTER"

finish
