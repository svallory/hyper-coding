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
SPACE="$FIX/space"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper" "$SPACE/worktrees/wt" "$HOME/.config/hyper"
PROJECT="$SPACE/.hyper/ship.yml"
USER_CFG="$HOME/.config/hyper/ship.yml"

# cfg <args...> — run ship-config from inside the space; stdout only.
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
assert_eq "project beats user beats defaults (base)" "develop" "$(cfg --get base)"
assert_eq "user beats defaults where project is silent (merge_method)" "squash" "$(cfg --get merge_method)"
assert_eq "project beats user (max_rounds)" "5" "$(cfg --get max_rounds)"
assert_eq "defaults supply what neither layer sets (mux)" "herdr" "$(cfg --get mux)"
assert_eq "project value (gate)" "make check" "$(cfg --get gate)"

# T2: user layer alone beats defaults ----------------------------------------
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
printf 'max_rounds: 9\n' > "$USER_CFG"
assert_eq "user layer overrides defaults" "9" "$(cfg --get max_rounds)"

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
assert_eq "array replaces (models.dev)" '["zai/glm-5.3:high","sonnet"]' "$(cfg --get models.dev)"
assert_eq "sibling key in the merged object survives (models.review)" '["opus"]' "$(cfg --get models.review)"
assert_eq "array replaces a default empty array (spec.paths)" '["docs/**"]' "$(cfg --get spec.paths)"
assert_eq "new map entry merges beside default (hosts.box.slots)" "3" "$(cfg --get hosts.box.slots)"
assert_eq "default map entry kept (hosts.local.slots)" "2" "$(cfg --get hosts.local.slots)"

# T4: defaults.yml ships the model lists AC-16 names --------------------------
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
assert_eq "default dev" '["sonnet"]' "$(cfg --get models.dev)"
assert_eq "default verify" '["haiku"]' "$(cfg --get models.verify)"
assert_eq "default review" '["opus"]' "$(cfg --get models.review)"
assert_eq "default spec_check" '["opus"]' "$(cfg --get models.spec_check)"
assert_eq "default final" '["opus"]' "$(cfg --get models.final)"
assert_eq "default spec_write" '["fable","opus"]' "$(cfg --get models.spec_write)"

# T5: missing gate -----------------------------------------------------------
reset_layers
assert_eq "no gate anywhere: exit 1" "1" "$(cfg_rc --print)"
assert_contains "no gate: message names the key" "$(cfg_err --print)" "'gate'"
assert_eq "no gate: --get also fails" "1" "$(cfg_rc --get base)"
printf 'gate: ""\n' > "$PROJECT"
assert_eq "empty gate counts as missing" "1" "$(cfg_rc --print)"
printf 'base: main\n' > "$PROJECT"
assert_eq "project file without gate: exit 1" "1" "$(cfg_rc --print)"
reset_layers
printf 'gate: "from-user"\n' > "$USER_CFG"
assert_eq "gate from the user layer satisfies the requirement" "from-user" "$(cfg --get gate)"

# T6: malformed YAML ---------------------------------------------------------
reset_layers
printf 'gate: "true"\nmodels: [unclosed\n  - nope: : :\n' > "$PROJECT"
assert_eq "malformed project YAML: exit 1" "1" "$(cfg_rc --print)"
assert_contains "malformed YAML: message names the file" "$(cfg_err --print)" "$PROJECT"
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
printf 'a: [\n' > "$USER_CFG"
assert_eq "malformed user YAML: exit 1" "1" "$(cfg_rc --print)"
assert_contains "malformed user YAML: message names the file" "$(cfg_err --print)" "$USER_CFG"
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
printf -- '- just\n- a list\n' > "$USER_CFG"
assert_eq "non-mapping top level: exit 1" "1" "$(cfg_rc --print)"

# T7: absent layers ----------------------------------------------------------
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
assert_eq "no user file: still works" "true" "$(cfg --get gate)"
reset_layers
printf 'gate: "from-user"\n' > "$USER_CFG"
assert_eq "no project file: still works" "from-user" "$(cfg --get gate)"
reset_layers
printf '' > "$PROJECT"
printf 'gate: "x"\n' > "$USER_CFG"
assert_eq "empty project file is an empty layer" "x" "$(cfg --get gate)"
# Outside any space there is no project layer at all.
outside="$FIX/not-a-space"; mkdir -p "$outside"
out="$(cd "$outside" && bash "$CFG" --get gate 2>&1)"
assert_eq "outside a space, user layer still used" "x" "$out"

# T8: --print annotates the source of each key --------------------------------
reset_layers
printf 'gate: "true"\nbase: develop\nmodels:\n  dev: [opus]\n' > "$PROJECT"
printf 'merge_method: squash\n' > "$USER_CFG"
out="$(cfg --print)"
assert_contains "print: project key shows project file" "$out" "base = \"develop\"  # $PROJECT"
assert_contains "print: user key shows user file" "$out" "merge_method = \"squash\"  # $USER_CFG"
assert_contains "print: default key shows defaults file" "$out" "mux = \"herdr\"  # $DEFAULTS"
assert_contains "print: nested key from project" "$out" "models.dev = [\"opus\"]  # $PROJECT"
assert_contains "print: sibling nested key from defaults" "$out" "models.review = [\"opus\"]  # $DEFAULTS"
assert_eq "no-arg call behaves as --print" "$out" "$(cfg)"
assert_eq "--get of an unset key exits 1" "1" "$(cfg_rc --get stages.verify.instructions)"
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
      for e in "$d"/*; do
        [[ "${e##*/}" == "$cmd" ]] && continue
        ln -sf "$e" "$farm/${e##*/}" 2>/dev/null
      done
      out="$out:$farm"
    else
      out="$out:$d"
    fi
  done
  printf '%s' "${out#:}"
}

reset_layers
printf 'gate: "true"\n' > "$PROJECT"
NOYQ_PATH="$(shadow_path_without yq)"
# shellcheck disable=SC2069
rc=0; err="$(cd "$SPACE/worktrees/wt" && PATH="$NOYQ_PATH" bash "$CFG" --print 2>&1 >/dev/null)" || rc=$?
assert_eq "yq missing: exit 1" "1" "$rc"
assert_contains "yq missing: message names yq" "$err" "yq is required"

stub_yq() { # stub_yq <dir> <version output>
  mkdir -p "$1"
  printf '#!/bin/sh\necho %s\n' "'$2'" > "$1/yq"
  chmod +x "$1/yq"
}
stub_yq "$FIX/yq-py" "yq 3.4.3"
# shellcheck disable=SC2069
rc=0; err="$(cd "$SPACE/worktrees/wt" && PATH="$FIX/yq-py:$REAL_PATH" bash "$CFG" --print 2>&1 >/dev/null)" || rc=$?
assert_eq "python yq: exit 1" "1" "$rc"
assert_contains "python yq: message says not mikefarah v4" "$err" "not mikefarah yq v4"
stub_yq "$FIX/yq-v3" "yq (https://github.com/mikefarah/yq/) version v3.4.1"
# shellcheck disable=SC2069
rc=0; err="$(cd "$SPACE/worktrees/wt" && PATH="$FIX/yq-v3:$REAL_PATH" bash "$CFG" --print 2>&1 >/dev/null)" || rc=$?
assert_eq "mikefarah v3: exit 1" "1" "$rc"
assert_contains "mikefarah v3: message says not v4" "$err" "not mikefarah yq v4"
assert_ok "the real yq in this environment passes the check" bash -c "source '$SHIP_DIR/lib.sh'; ship_require_yq"

# T10: model parser ------------------------------------------------------------
# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
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
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
ovr() { # ovr <spec> <stage> — models.<stage> after the override
  (cd "$SPACE/worktrees/wt" && unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS \
    && ship_config_load && ship_models_override "$1" && ship_cfg_get "models.$2")
}
assert_eq "override replaces one list" '["opus","zai/glm-5.3:high"]' "$(ovr 'dev=opus,zai/glm-5.3:high' dev)"
assert_eq "override leaves other stages alone" '["haiku"]' "$(ovr 'dev=opus' verify)"
assert_eq "single-model override" '["haiku"]' "$(ovr 'review=haiku' review)"
rc=0; (cd "$SPACE/worktrees/wt" && ship_config_load && ship_models_override "bogus=opus") >/dev/null 2>&1 || rc=$?
assert_eq "unknown stage rejected" "1" "$rc"
rc=0; (cd "$SPACE/worktrees/wt" && ship_config_load && ship_models_override "dev") >/dev/null 2>&1 || rc=$?
assert_eq "missing '=' rejected" "1" "$rc"
rc=0; (cd "$SPACE/worktrees/wt" && ship_config_load && ship_models_override "dev=") >/dev/null 2>&1 || rc=$?
assert_eq "empty list rejected" "1" "$rc"
rc=0; (cd "$SPACE/worktrees/wt" && ship_config_load && ship_models_override "dev=opus,zai/") >/dev/null 2>&1 || rc=$?
assert_eq "an invalid model inside the list is rejected" "1" "$rc"

# T12: config is read once per run ---------------------------------------------
cnt="$FIX/yq-count"; : > "$cnt"
mkdir -p "$FIX/yq-spy"
real_yq="$(command -v yq)"
printf '#!/bin/sh\necho x >> "%s"\nexec "%s" "$@"\n' "$cnt" "$real_yq" > "$FIX/yq-spy/yq"
chmod +x "$FIX/yq-spy/yq"
rm -f "$USER_CFG"
(cd "$SPACE/worktrees/wt" && PATH="$FIX/yq-spy:$REAL_PATH" bash -c "
  source '$SHIP_DIR/lib.sh'
  ship_config_load; ship_config_load; ship_config_load
  # A child that inherits the exports does not re-read either.
  bash -c \"source '$SHIP_DIR/lib.sh'; ship_config_load\"") >/dev/null 2>&1
# --version probes do not count; parses are one per layer file (defaults + project).
parses="$(grep -c x "$cnt")"
if [[ "$parses" -le 4 ]]; then pass "layers parsed once (yq calls: $parses, version probes included)"; else fail "layers re-read (yq calls: $parses)"; fi

# T13: C-14 — every key in defaults.yml is commented ---------------------------
undocumented="$(awk '/^[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*:/ { if (prev !~ /^[[:space:]]*#/ && $0 !~ /[[:space:]]#/) print NR": "$0 } {prev=$0}' "$DEFAULTS")"
assert_eq "every key line in defaults.yml has a comment" "" "$undocumented"
# The checker itself must catch an undocumented key.
printf '# ok\na: 1\nb: 2\n' > "$FIX/bad.yml"
bad="$(awk '/^[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*:/ { if (prev !~ /^[[:space:]]*#/ && $0 !~ /[[:space:]]#/) print NR": "$0 } {prev=$0}' "$FIX/bad.yml")"
assert_eq "comment checker flags an undocumented key" "3: b: 2" "$bad"
# Every leaf key of the merged defaults is covered by the table in the design.
reset_layers
printf 'gate: "true"\n' > "$PROJECT"
keys="$(cfg --print | sed 's/ = .*//' | tr '\n' ' ')"
for k in mux units_group base merge_method spec.paths scan.forbidden scan.exclude stages.final.always max_rounds \
         models.dev models.verify models.review models.spec_check models.spec_write models.final \
         quota.threshold_pct quota.max_age_min limits.patterns.claude limits.patterns.pi limits.cooldown_min \
         failover.summarizer budgets.S budgets.M budgets.L budgets.fix_fraction budgets.check \
         hosts.local.slots rulings tracker on_land roles.dev.pi_skills roles.lead.plugins_keep; do
  assert_contains "defaults.yml defines $k" "$keys" "$k "
done
assert_contains "gate has no default" "$(grep -c '^gate:' "$DEFAULTS")" "0"
# The limit patterns survive YAML quoting intact.
assert_eq "claude limit pattern" 'You.{1,3}ve hit your ([a-z]+ )?limit' "$(cfg --get limits.patterns.claude)"
assert_eq "pi limit pattern" '(?i)(rate.?limit|usage limit|quota exceeded|\b429\b)' "$(cfg --get limits.patterns.pi)"

# T14: no host/project/model literals in the scripts (C-1) -----------------------
leaks="$(grep -niE 'husk|forge|/work/lab|/Users/|sonnet|opus|haiku|fable' "$SHIP_DIR/lib.sh" "$SHIP_DIR/ship-config")"
assert_eq "no husk/host/model literals in lib.sh and ship-config" "" "$leaks"

finish
