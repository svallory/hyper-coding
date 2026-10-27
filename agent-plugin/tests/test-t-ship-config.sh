#!/usr/bin/env bash
# Row T (ship-config) — layered ship.yml config: defaults < user < project,
# the loader in scripts/ship/lib.sh, and the ship-config CLI.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
CFG="$SHIP_DIR/ship-config"
DEFAULTS="$PLUGIN_DIR/skills/ship/defaults.yml"
REAL_PATH="$PATH"

# A space with a worktree to run from, and an empty user config dir.
SPACE="$FIX/my space"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt" "$HOME/.config/hyper"
PROJECT="$SPACE/.hyper/ship.yml"
USER_CFG="$HOME/.config/hyper/ship.yml"

# The loader runs in-process (sourced) wherever the CLI adds nothing: one
# `ship-config` spawn costs ~40 forks, and a --get per key paid it per key.
# SHIP_SPACE_ROOT is exported so space detection never spawns the node CLI;
# the cases that test detection itself use `env -u SHIP_SPACE_ROOT`.
assert_eq "SHIP_CONFIG_JSON is unset at entry (run.sh strips SHIP_*)" "" "${SHIP_CONFIG_JSON:-}"
export SHIP_SPACE_ROOT="$SPACE"
# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
# lc — load the layers afresh, in this shell (what ship-config does first).
# The cache stays a shell variable (not exported) so a spawned ship-config
# re-reads its own layers instead of inheriting this one.
lc() { unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load && export -n SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; }
# g <key> — what `ship-config --get <key>` prints; rc 3 when unset.
g() { ship_cfg_get "$1"; }
# lc_try — load in a subshell; sets rc and err (stderr) without keeping the config.
lc_try() { rc=0; err="$( { lc; } 2>&1 )" || rc=$?; }

# lc_plain — the most common fixture (project `gate: "true"`, no user layer),
# loaded once and restored from memory afterwards.
_PLAIN_JSON="" _PLAIN_LAYERS=""
lc_plain() {
  reset_layers
  printf 'gate: "true"\n' > "$PROJECT"
  if [[ -n "$_PLAIN_JSON" ]]; then
    SHIP_CONFIG_JSON="$_PLAIN_JSON" SHIP_CONFIG_LAYERS="$_PLAIN_LAYERS"
  else
    lc && { _PLAIN_JSON="$SHIP_CONFIG_JSON" _PLAIN_LAYERS="$SHIP_CONFIG_LAYERS"; }
  fi
}

# cfg <args...> — run the real ship-config from inside the space; stdout only.
cfg() { (cd "$SPACE/worktrees/wt" && bash "$CFG" "$@" 2>/dev/null); }
# cfg_rc <args...> — exit code
cfg_rc() { (cd "$SPACE/worktrees/wt" && bash "$CFG" "$@" >/dev/null 2>&1); echo $?; }
# cfg_err <args...> — stderr only
# shellcheck disable=SC2069
cfg_err() { (cd "$SPACE/worktrees/wt" && bash "$CFG" "$@" 2>&1 >/dev/null); }

reset_layers() { rm -f "$PROJECT" "$USER_CFG"; }

# T1: project layer wins over user and defaults ------------------------------
reset_layers
printf 'gate: "make check"\nbase: develop\nmax_rounds: 5\n' > "$PROJECT"
printf 'max_rounds: 7\nbase: trunk\nmerge_method: squash\n' > "$USER_CFG"
assert_eq "CLI smoke: ship-config --get reads the project layer" "develop" "$(cfg --get base)"
lc
assert_eq "project beats user beats defaults (base)" "develop" "$(g base)"
assert_eq "user beats defaults where project is silent (merge_method)" "squash" "$(g merge_method)"
assert_eq "project beats user (max_rounds)" "5" "$(g max_rounds)"
assert_eq "defaults supply what neither layer sets (mux)" "herdr" "$(g mux)"
assert_eq "project value (gate)" "make check" "$(g gate)"

# T2: user layer alone beats defaults ----------------------------------------
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
printf 'max_rounds: 9\n' > "$USER_CFG"
lc
assert_eq "user layer overrides defaults" "9" "$(g max_rounds)"

# T3: objects merge, arrays replace ------------------------------------------
reset_layers
cat > "$PROJECT" <<'YAML'
gate: "true"
models:
  dev: [zai/glm-5.3:high, sonnet]
spec:
  paths: ["docs/**"]
hosts:
  box: {ssh: box, slots: 3}
YAML
lc
assert_eq "array replaces (models.dev)" '["zai/glm-5.3:high","sonnet"]' "$(g models.dev)"
assert_eq "sibling key in the merged object survives (models.review)" '["opus"]' "$(g models.review)"
assert_eq "array replaces a default empty array (spec.paths)" '["docs/**"]' "$(g spec.paths)"
assert_eq "new map entry merges beside default (hosts.box.slots)" "3" "$(g hosts.box.slots)"
assert_eq "default map entry kept (hosts.local.slots)" "2" "$(g hosts.local.slots)"

# T4: defaults.yml ships the model lists AC-16 names --------------------------
lc_plain
assert_eq "default dev" '["sonnet"]' "$(g models.dev)"
assert_eq "default verify" '["haiku"]' "$(g models.verify)"
assert_eq "default review" '["opus"]' "$(g models.review)"
assert_eq "default spec_check" '["opus"]' "$(g models.spec_check)"
assert_eq "default final" '["opus"]' "$(g models.final)"
assert_eq "default spec_write" '["fable","opus"]' "$(g models.spec_write)"

# T5: gate is required by the callers that run it, not by loading ------------
# gate_check <desc> <exit> <fragment> — ship_require_gate on the current layers.
gate_check() {
  local r=0 e
  e="$( { lc && ship_require_gate; } 2>&1 )" || r=$?
  assert_eq "$1: exit $2" "$2" "$r"
  [[ -z "$3" ]] || assert_contains "$1: message" "$e" "$3"
}
reset_layers
# CLI: --print still prints the rest and marks gate required; --get gate fails.
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --print 2>"$FIX/cli.err")"; rc=$?
assert_eq "no gate: --print exits 1" "1" "$rc"
assert_contains "no gate: --print still prints the rest" "$out" 'mux = "herdr"'
assert_contains "no gate: --print marks gate required" "$out" "gate = <unset: required>"
assert_contains "no gate: the message is on stderr and names the key" "$(<"$FIX/cli.err")" "'gate'"
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --get base 2>/dev/null)"; rc=$?
assert_eq "no gate: --get base exits 0" "0" "$rc"
assert_eq "no gate: --get base prints the value" "main" "$out"
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --get gate 2>&1)"; rc=$?
assert_eq "no gate: --get gate exits 1" "1" "$rc"
assert_contains "no gate: --get gate names the key" "$out" "'gate'"
gate_check "ship_require_gate without a gate" 1 "'gate'"
lc
assert_eq "no gate: other keys still load (base)" "main" "$(g base)"
printf 'gate: ""\n' > "$PROJECT"
gate_check "empty gate" 1 "non-empty string"
printf 'gate: true\n' > "$PROJECT"
gate_check "boolean gate" 1 "gate must be a non-empty string (got boolean)"
printf 'gate: 123\n' > "$PROJECT"
gate_check "number gate" 1 "gate must be a non-empty string (got number)"
printf 'base: main\n' > "$PROJECT"
gate_check "project file without gate" 1 "'gate'"
reset_layers
printf 'gate: "from-user"\n' > "$USER_CFG"
gate_check "gate from the user layer satisfies the requirement" 0 ""
lc
assert_eq "gate from the user layer is the value" "from-user" "$(g gate)"

# T5b: --get exit codes: unset is 3, an empty string is a value -------------------
reset_layers
printf 'gate: "true"\ntracker: ""\nbase: ~\n' > "$PROJECT"
lc
rc=0; g tracker >/dev/null || rc=$?
assert_eq "empty string: exit 0" "0" "$rc"
assert_eq "empty string: prints one empty line" "|" "$(g tracker | tr '\n' '|')"
rc=0; g base >/dev/null || rc=$?
assert_eq "null value: exit 3" "3" "$rc"
rc=0; g no.such.key >/dev/null || rc=$?
assert_eq "absent key: exit 3" "3" "$rc"
rc=0; g gate.sub >/dev/null || rc=$?
assert_eq "path through a scalar: exit 3" "3" "$rc"
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --get no.such.key 2>&1)"; rc=$?
assert_eq "CLI: unset key exits 3" "3" "$rc"
assert_contains "CLI: unset message names the key" "$out" "'no.such.key' is not set"

# T6: malformed YAML ---------------------------------------------------------
reset_layers
printf 'gate: "true"\nmodels: [unclosed\n  - nope: : :\n' > "$PROJECT"
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --print 2>&1)"; rc=$?
assert_eq "CLI: a config error stays exit 1" "1" "$rc"
assert_contains "malformed YAML: message names the file" "$out" "$PROJECT"
lc_try
assert_eq "malformed project YAML: load fails" "1" "$rc"
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
printf 'a: [\n' > "$USER_CFG"
lc_try
assert_eq "malformed user YAML: load fails" "1" "$rc"
assert_contains "malformed user YAML: message names the file" "$err" "$USER_CFG"
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
printf -- '- just\n- a list\n' > "$USER_CFG"
lc_try
assert_eq "non-mapping top level: load fails" "1" "$rc"

# T7: absent layers ----------------------------------------------------------
lc_plain
assert_eq "no user file: still works" "true" "$(g gate)"
reset_layers
printf 'gate: "from-user"\n' > "$USER_CFG"
lc
assert_eq "no project file: still works" "from-user" "$(g gate)"
reset_layers
printf '' > "$PROJECT"
printf 'gate: "x"\n' > "$USER_CFG"
lc
assert_eq "empty project file is an empty layer" "x" "$(g gate)"
# Outside any space there is no project layer at all (real detection: CLI).
outside="$FIX/not-a-space"; mkdir -p "$outside"
out="$(cd "$outside" && env -u SHIP_SPACE_ROOT bash "$CFG" --get gate 2>&1)"
assert_eq "outside a space, user layer still used" "x" "$out"

# T8: --print annotates the source of each key --------------------------------
reset_layers
printf 'gate: "true"\nbase: develop\nmodels:\n  dev: [opus]\n' > "$PROJECT"
printf 'merge_method: squash\n' > "$USER_CFG"
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --print 2>/dev/null)"; rc=$?
assert_eq "valid config: --print exits 0" "0" "$rc"
assert_contains "print: project key shows project file" "$out" "base = \"develop\"  # $PROJECT"
assert_contains "print: user key shows user file" "$out" "merge_method = \"squash\"  # $USER_CFG"
assert_contains "print: default key shows defaults file" "$out" "mux = \"herdr\"  # $DEFAULTS"
assert_contains "print: nested key from project" "$out" "models.dev = [\"opus\"]  # $PROJECT"
assert_contains "print: sibling nested key from defaults" "$out" "models.review = [\"opus\"]  # $DEFAULTS"
assert_eq "no-arg call behaves as --print" "$out" "$(cfg)"
lc
rc=0; g stages.verify.instructions >/dev/null || rc=$?
assert_eq "--get of an unset key exits 3" "3" "$rc"
assert_eq "unknown flag exits 2" "2" "$(cfg_rc --nope)"
assert_eq "--get without key exits 2" "2" "$(cfg_rc --get)"

# T9: yq missing / not mikefarah v4 -------------------------------------------
# shadow_path_without <cmd> — a PATH where <cmd> cannot be found: every PATH
# directory that holds it is replaced by a symlink farm of its other entries.
shadow_path_without() {
  local cmd="$1" d e n=0 out="" farm
  local IFS=:
  for d in $REAL_PATH; do
    [[ -d "$d" ]] || continue
    if [[ -e "$d/$cmd" ]]; then
      n=$((n + 1)); farm="$FIX/farm$n"; mkdir -p "$farm"
      # One ln for the whole directory (a per-entry loop forked ~1000 times).
      ln -sf "$d"/* "$farm/" 2>/dev/null
      rm -f "$farm/$cmd"
      out="$out:$farm"
    else
      out="$out:$d"
    fi
  done
  printf '%s' "${out#:}"
}

NOYQ_PATH="$(shadow_path_without yq)"
rc=0; err="$(PATH="$NOYQ_PATH" ship_require_yq 2>&1)" || rc=$?
assert_eq "yq missing: exit 1" "1" "$rc"
assert_contains "yq missing: message names yq" "$err" "yq is required"

stub_yq() { # stub_yq <dir> <version output>
  mkdir -p "$1"
  printf '#!/bin/sh\necho %s\n' "'$2'" > "$1/yq"
  chmod +x "$1/yq"
}
stub_yq "$FIX/yq-py" "yq 3.4.3"
rc=0; err="$(PATH="$FIX/yq-py:$REAL_PATH" ship_require_yq 2>&1)" || rc=$?
assert_eq "python yq: exit 1" "1" "$rc"
assert_contains "python yq: message says not mikefarah v4" "$err" "not mikefarah yq v4"
stub_yq "$FIX/yq-v3" "yq (https://github.com/mikefarah/yq/) version v3.4.1"
rc=0; err="$(PATH="$FIX/yq-v3:$REAL_PATH" ship_require_yq 2>&1)" || rc=$?
assert_eq "mikefarah v3: exit 1" "1" "$rc"
assert_contains "mikefarah v3: message says not v4" "$err" "not mikefarah yq v4"
assert_ok "the real yq in this environment passes the check" ship_require_yq

# T10: model parser ------------------------------------------------------------
TAB=$'\t'
assert_eq "bare name -> claude" "claude${TAB}${TAB}sonnet${TAB}" "$(ship_model_parse sonnet)"
assert_eq "bare alias -> claude" "claude${TAB}${TAB}fable${TAB}" "$(ship_model_parse fable)"
assert_eq "provider/model -> pi" "pi${TAB}zai${TAB}glm-5.3${TAB}" "$(ship_model_parse zai/glm-5.3)"
assert_eq "provider/model:thinking -> pi with thinking" "pi${TAB}zai${TAB}glm-5.3${TAB}high" "$(ship_model_parse zai/glm-5.3:high)"
assert_eq "nested model path keeps everything after the provider" "pi${TAB}openrouter${TAB}a/b${TAB}low" "$(ship_model_parse openrouter/a/b:low)"
assert_fails "empty model rejected" ship_model_parse ""
assert_fails "empty provider rejected" ship_model_parse "/glm"
assert_fails "empty model name rejected" ship_model_parse "zai/"
assert_fails "empty thinking rejected" ship_model_parse "zai/glm:"
assert_fails "whitespace rejected" ship_model_parse "zai/glm 5"
assert_fails "bare name with thinking rejected" ship_model_parse "sonnet:high"

# T11: stage=a,b override parser -----------------------------------------------
lc_plain
ovr() { # ovr <spec> <stage> — models.<stage> after the override
  ( ship_models_override "$1" && ship_cfg_get "models.$2" )
}
assert_eq "override replaces one list" '["opus","zai/glm-5.3:high"]' "$(ovr 'dev=opus,zai/glm-5.3:high' dev)"
assert_eq "override leaves other stages alone" '["haiku"]' "$(ovr 'dev=opus' verify)"
assert_eq "single-model override" '["haiku"]' "$(ovr 'review=haiku' review)"
for bad in "bogus=opus:unknown stage" "dev:missing '='" "dev=:empty list" "dev=opus,zai/:an invalid model inside the list"; do
  rc=0; (ship_models_override "${bad%%:*}") >/dev/null 2>&1 || rc=$?
  assert_eq "${bad#*:} rejected" "1" "$rc"
done

# T12: config is read once per run ---------------------------------------------
cnt="$FIX/yq-count"; : > "$cnt"
mkdir -p "$FIX/yq-spy"
real_yq="$(command -v yq)"
printf '#!/bin/sh\necho x >> "%s"\nexec "%s" "$@"\n' "$cnt" "$real_yq" > "$FIX/yq-spy/yq"
chmod +x "$FIX/yq-spy/yq"
rm -f "$USER_CFG"
(cd "$SPACE/worktrees/wt" && unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS && PATH="$FIX/yq-spy:$REAL_PATH" bash -c "
  source '$SHIP_DIR/lib.sh'
  ship_config_load; ship_config_load; ship_config_load
  # A child that inherits the exports does not re-read either.
  bash -c \"source '$SHIP_DIR/lib.sh'; ship_config_load\"") >/dev/null 2>&1
# --version probes do not count; parses are one per layer file (defaults + project).
parses="$(grep -c x "$cnt")"
if [[ "$parses" -eq 3 ]]; then pass "layers parsed once (3 yq calls: version probe + defaults + project)"; else fail "layers re-read (yq calls: $parses)"; fi

# T13: C-14 — every key in defaults.yml is commented ---------------------------
undocumented="$(awk '/^[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*:/ { if (prev !~ /^[[:space:]]*#/ && $0 !~ /[[:space:]]#/) print NR": "$0 } {prev=$0}' "$DEFAULTS")"
assert_eq "every key line in defaults.yml has a comment" "" "$undocumented"
# The checker itself must catch an undocumented key.
printf '# ok\na: 1\nb: 2\n' > "$FIX/bad.yml"
bad="$(awk '/^[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*:/ { if (prev !~ /^[[:space:]]*#/ && $0 !~ /[[:space:]]#/) print NR": "$0 } {prev=$0}' "$FIX/bad.yml")"
assert_eq "comment checker flags an undocumented key" "3: b: 2" "$bad"
# Every leaf key of the merged defaults is covered by the table in the design.
lc_plain
keys="$(ship_cfg_print | sed 's/ = .*//' | tr '\n' ' ')"
for k in mux units_group base merge_method spec.paths scan.forbidden scan.exclude stages.final.always max_rounds \
         models.dev models.verify models.review models.spec_check models.spec_write models.final \
         quota.threshold_pct quota.max_age_min limits.patterns.claude limits.patterns.pi limits.cooldown_min \
         failover.summarizer budgets.S budgets.M budgets.L budgets.fix_fraction budgets.fix_per_finding budgets.check \
         hosts.local.slots rulings tracker on_land roles.dev.pi_skills roles.lead.plugins_keep; do
  assert_contains "defaults.yml defines $k" "$keys" "$k "
done
assert_eq "gate has no default" "0" "$(grep -c '^gate:' "$DEFAULTS")"
# The limit patterns survive YAML quoting intact.
# shellcheck disable=SC1112  # the curly quotes are part of the pattern
assert_eq "claude limit pattern" '(?i)^\s*([^[:alnum:]\s+>"\x27`“”‘’-]\s*)?You.{1,3}ve hit your ([a-z]+ )?limit\s*($|[·∙]\s*resets)' "$(g limits.patterns.claude)"
assert_eq "pi limit pattern" '(?i)^[^[:alnum:]+>-]*((((api |provider |http )?error:?|✗)\s*(429\s*)?|429\s*)((too many requests|status code( 429)?)\s*([.!]|:.*|[({\[].*)?\s*$|resource_exhausted)|(((api |provider |http )?error:?|✗)\s*)?(429\b.*rate_limit_error|429\b.{0,30}rate.?limit|\{"error":\{"code":"?(1302|1308)\b|(rate|usage) limit (has been )?(reached|exceeded|hit)( for .*)?\s*[.!]?\s*$|quota (has been )?exceeded([.!,:]|\s*$|\sfor\s)|(you )?exceeded (your|the) (current )?(quota|rate limit|usage limit)([.!,:]|\s*$)))' "$(g limits.patterns.pi)"

# T15: space root without the hyper CLI (#1) -----------------------------------
reset_layers
printf 'gate: "from-project"\nbase: proj\n' > "$PROJECT"
NOHYPER_PATH="$(shadow_path_without hyper)"
rc=0; err="$(cd "$SPACE/worktrees/wt" && PATH="$NOHYPER_PATH" env -u SHIP_SPACE_ROOT bash "$CFG" --get base 2>&1 >/dev/null)" || rc=$?
assert_eq "no hyper, no SHIP_SPACE_ROOT: exit 1 (project layer is not silently dropped)" "1" "$rc"
assert_contains "no hyper: message says cannot locate the space root" "$err" "cannot locate the space root: hyper CLI missing or outdated (missing)"
assert_contains "no hyper: message offers SHIP_SPACE_ROOT" "$err" "set SHIP_SPACE_ROOT"
out="$(cd "$SPACE/worktrees/wt" && PATH="$NOHYPER_PATH" lc && g base)"
assert_eq "no hyper + SHIP_SPACE_ROOT: project layer read" "proj" "$out"
out="$(cd "$outside" && PATH="$NOHYPER_PATH" lc && g base)"
assert_eq "SHIP_SPACE_ROOT wins regardless of cwd" "proj" "$out"
out="$(cd "$SPACE/worktrees/wt" && SHIP_SPACE_ROOT="" ship_space_root)"
assert_eq "empty SHIP_SPACE_ROOT is treated as unset (real detection)" "$SPACE" "$out"
# An outdated CLI: a stub whose library carries no version stamp.
mkdir -p "$FIX/oldhyper"
printf '# no HYPER_LIB_VERSION here\n' > "$FIX/oldhyper/hyper-lib.sh"
printf '#!/bin/sh\necho "%s"\n' "$FIX/oldhyper/hyper-lib.sh" > "$FIX/oldhyper/hyper"
chmod +x "$FIX/oldhyper/hyper"
rc=0; err="$(cd "$SPACE/worktrees/wt" && PATH="$FIX/oldhyper:$REAL_PATH" env -u SHIP_SPACE_ROOT bash "$CFG" --get base 2>&1 >/dev/null)" || rc=$?
assert_eq "outdated hyper: exit 1" "1" "$rc"
assert_contains "outdated hyper: reason named" "$err" "(outdated)"
rc=0; (cd "$outside" && PATH="$NOHYPER_PATH" env -u SHIP_SPACE_ROOT bash -c "source '$SHIP_DIR/lib.sh'; ship_space_root") >/dev/null 2>&1 || rc=$?
assert_eq "ship_space_root returns 2 when it cannot tell" "2" "$rc"
rc=0; (cd "$outside" && env -u SHIP_SPACE_ROOT bash -c "source '$SHIP_DIR/lib.sh'; ship_space_root") >/dev/null 2>&1 || rc=$?
assert_eq "ship_space_root returns 1 outside a space" "1" "$rc"

# T15b: SHIP_SPACE_ROOT is checked and normalised ------------------------------
printf 'gate: "true"\n' > "$PROJECT"
out="$(cd "$outside" && SHIP_SPACE_ROOT="$SPACE/" && lc && g units_group)"
assert_eq "trailing slash: units_group expands" "my space-units" "$out"
out="$(cd "$outside" && SHIP_SPACE_ROOT="$SPACE//" && lc && g units_group)"
assert_eq "double trailing slash: units_group expands" "my space-units" "$out"
rc=0; err="$( { SHIP_SPACE_ROOT="$FIX/nope"; lc; } 2>&1 )" || rc=$?
assert_eq "missing SHIP_SPACE_ROOT directory: load fails" "1" "$rc"
assert_contains "missing directory: message" "$err" "SHIP_SPACE_ROOT=$FIX/nope is not a directory"
rc=0; (SHIP_SPACE_ROOT="$FIX/nope"; ship_space_root) >/dev/null 2>&1 || rc=$?
assert_eq "ship_space_root returns 2 for a missing directory" "2" "$rc"
ln -s "$SPACE" "$FIX/space-link"
assert_eq "symlinked SHIP_SPACE_ROOT is resolved physically" "$SPACE" "$(SHIP_SPACE_ROOT="$FIX/space-link/" ship_space_root)"

# T16: yq stderr never pollutes the JSON (#2) -----------------------------------
reset_layers
cat > "$PROJECT" <<'YAML'
gate: "true"
base_hosts: &h
  slots: 4
hosts:
  box:
    <<: *h
    ssh: box
YAML
lc_try
assert_eq "anchor + merge key: loads" "0" "$rc"
lc
assert_eq "anchor + merge key: merged value arrives" "4" "$(g hosts.box.slots)"
mkdir -p "$FIX/yq-noisy"
printf '#!/bin/sh\necho "WARN: something odd" >&2\nexec "%s" "$@"\n' "$real_yq" > "$FIX/yq-noisy/yq"
chmod +x "$FIX/yq-noisy/yq"
printf 'gate: "true"\n' > "$PROJECT"
out="$(PATH="$FIX/yq-noisy:$REAL_PATH" && lc 2>/dev/null && g gate)"
assert_eq "a yq that warns on stderr (exit 0) still parses" "true" "$out"

# T17: validation names the key and the layer (#5) ------------------------------
bad_cfg() { # bad_cfg <desc> <yaml> <expected fragment>
  printf 'gate: "true"\n%s\n' "$2" > "$PROJECT"
  lc_try
  assert_eq "$1: load fails" "1" "$rc"
  assert_contains "$1: message" "$err" "$3"
}
# One CLI row: validation failure maps to exit 1 with the message on stderr.
printf 'gate: "true"\nmodels: {dev: []}\n' > "$PROJECT"
out="$(cd "$SPACE/worktrees/wt" && bash "$CFG" --print 2>&1)"; rc=$?
assert_eq "CLI: invalid config exits 1" "1" "$rc"
assert_contains "CLI: invalid config message" "$out" "models.dev must be a non-empty list"
# Validation reports every bad key in one pass, so distinct keys share a load.
# Each key keeps its own message assertion.
bad_cfg "models: null" 'models: ~' "models.dev"
printf 'gate: "true"\nmodels: {dev: ~, spec_check: sonnet, final: [], review: ["zai/"], verify: [1]}\nfailover: {summarizer: ["a b"]}\nmax_rounds: lots\nbudgets: {S: fast, fix_per_finding: -1, fix_fraction: ~}\n' > "$PROJECT"
lc_try
assert_eq "invalid keys: load fails" "1" "$rc"
assert_contains "models.dev null" "$err" "models.dev must be a non-empty list of models (got null)"
assert_contains "models.spec_check scalar" "$err" "models.spec_check must be a non-empty list of models (got string)"
assert_contains "models.final empty" "$err" "models.final must be a non-empty list"
assert_contains "models.review bad model" "$err" "models.review"
assert_contains "non-string entry" "$err" "models.verify entry 1 is not a string"
assert_contains "failover.summarizer bad" "$err" "failover.summarizer"
assert_contains "max_rounds not a number" "$err" "max_rounds must be a number (got string)"
assert_contains "budgets.S not a number" "$err" "budgets.S must be a number"
assert_contains "budgets.fix_per_finding negative" "$err" "budgets.fix_per_finding must not be negative"
assert_contains "budgets.fix_fraction null" "$err" "budgets.fix_fraction must be a number (got null)"
assert_contains "validation names the project layer file" "$err" "$PROJECT"
bad_cfg "failover.summarizer empty + fix_per_finding string" 'failover: {summarizer: []}
budgets: {fix_per_finding: lots}' "failover.summarizer must be a non-empty list"
assert_contains "budgets.fix_per_finding not a number" "$err" "budgets.fix_per_finding must be a number (got string)"
printf 'models: {spec_check: []}\n' > "$USER_CFG"
printf 'gate: "true"\n' > "$PROJECT"
lc_try
assert_contains "validation names the user layer file" "$err" "$USER_CFG"
rm -f "$USER_CFG"
printf 'gate: "true"\nmodels: {dev: [zai/glm-5.3:high, sonnet], spec_write: [fable]}\nmax_rounds: 4\nbudgets: {fix_fraction: 0.25}\n' > "$PROJECT"
lc_try
assert_eq "valid overrides pass validation" "0" "$rc"

# T18: multi-document YAML (#6) -------------------------------------------------
printf 'gate: "true"\n---\nbase: other\n' > "$PROJECT"
lc_try
assert_eq "multi-document YAML: load fails" "1" "$rc"
assert_contains "multi-document YAML: message" "$err" "multiple YAML documents"
assert_contains "multi-document YAML: names the file" "$err" "$PROJECT"

# T19: unset HOME (#7) ----------------------------------------------------------
printf 'gate: "true"\nbase: nohome\n' > "$PROJECT"
rc=0; out="$(cd "$SPACE/worktrees/wt" && env -u HOME SHIP_SPACE_ROOT="$SPACE" bash "$CFG" --get base 2>&1)" || rc=$?
assert_eq "unset HOME: exit 0" "0" "$rc"
assert_eq "unset HOME: project layer still read" "nohome" "$out"

# T20: <project> expansion (#8) ---------------------------------------------------
printf 'gate: "true"\n' > "$PROJECT"
lc
assert_eq "units_group expanded to the space dir name" "my space-units" "$(g units_group)"
assert_contains "--print shows the expanded name" "$(ship_cfg_print)" 'units_group = "my space-units"'
printf 'gate: "true"\nunits_group: "grp-<project>-x"\n' > "$PROJECT"
lc
assert_eq "expansion applies to a project override" "grp-my space-x" "$(g units_group)"
assert_eq "ship_project is the space dir name" "my space" "$(ship_project)"
UNI="$FIX/café ☃"
make_bare_space "$UNI"; mkdir -p "$UNI/.hyper" "$UNI/worktrees/w"
printf 'gate: "true"\nrulings: "notes/décisions ☃.md"\n' > "$UNI/.hyper/ship.yml"
assert_eq "unicode space name expands" "café ☃-units" "$(cd "$UNI/worktrees/w" && env -u SHIP_SPACE_ROOT bash "$CFG" --get units_group 2>/dev/null)"
assert_eq "unicode value round-trips" "notes/décisions ☃.md" "$(SHIP_SPACE_ROOT="$UNI" && lc && g rulings)"
out="$(cd "$outside" && rm -f "$USER_CFG" && printf 'gate: x\n' > "$USER_CFG" && env -u SHIP_SPACE_ROOT bash "$CFG" --get units_group 2>/dev/null)"
assert_eq "outside a space <project> is left as written" "<project>-units" "$out"
rm -f "$USER_CFG"

# T21: role shapes in defaults (#9) ---------------------------------------------
printf 'gate: "true"\n' > "$PROJECT"
lc
assert_eq "dev pi_extensions is a name+flags map" '[{"name":"pi-lens","flags":["--no-autofix","--no-tests","--no-opengrep"]}]' "$(g roles.dev.pi_extensions)"
defj="$(yq -o=json . "$DEFAULTS")"
shapes="$(jq -r '[.roles | to_entries[] | select(.key | IN("dev","verify","review","spec")) | "\(.key) \(.value.pi_skills | type) \(.value.pi_extensions | type)"] | .[]' <<<"$defj")"
for r in dev verify review spec; do
  assert_contains "roles.$r.pi_skills and pi_extensions are lists" "$shapes" "$r array array"
done

# T22: script location without a slash, and via symlinks (#11) -------------------
assert_eq "invoked as a bare name from its own directory" "herdr" "$(cd "$SHIP_DIR" && SHIP_SPACE_ROOT="$SPACE" bash ship-config --get mux 2>/dev/null)"
assert_eq "lib.sh sourced as a bare name" "0" "$(cd "$SHIP_DIR" && SHIP_SPACE_ROOT="$SPACE" bash -c 'source lib.sh; ship_config_load; echo $?' 2>/dev/null | tail -1)"
# One chain covers: absolute link in a dir with a space -> relative link -> script,
# invoked as a bare name from the link's own directory.
mkdir -p "$FIX/links/abs dir" "$FIX/links/rel"
rel="$(python3 -c 'import os,sys;print(os.path.relpath(sys.argv[1],sys.argv[2]))' "$CFG" "$FIX/links/rel")"
ln -s "$rel" "$FIX/links/rel/ship-config"
ln -s "$FIX/links/rel/ship-config" "$FIX/links/abs dir/ship-config"
assert_eq "bare-name call through an absolute link to a relative link" "herdr" "$(cd "$FIX/links/abs dir" && SHIP_SPACE_ROOT="$SPACE" bash ship-config --get mux 2>/dev/null)"

# T14: no host/project/model literals in the scripts (C-1) -----------------------
leaks="$(grep -niE 'husk|forge|/work/lab|/Users/|sonnet|opus|haiku|fable' "$SHIP_DIR/lib.sh" "$SHIP_DIR/ship-config")"
assert_eq "no husk/host/model literals in lib.sh and ship-config" "" "$leaks"

finish
