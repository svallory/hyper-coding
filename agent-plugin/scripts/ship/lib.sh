#!/usr/bin/env bash
# Shared helpers for the ship scripts. Source it; do not execute it.
#
#   source "${BASH_SOURCE[0]%/*}/lib.sh"
#
# It sets no shell options of its own. Functions print "ship: ..." on stderr and
# return 1 on failure; the calling script decides whether that is fatal.
#
# Config
#   ship_require_yq            yq present and mikefarah v4, else return 1
#   ship_space_root            print the space root: $SHIP_SPACE_ROOT if set, else
#                              the hyper CLI's find_space_root. Returns 1 when cwd
#                              is not in a space, 2 when the hyper CLI is missing
#                              or outdated and SHIP_SPACE_ROOT is unset.
#   ship_project               print the project name (basename of the space root)
#   ship_config_load           load, merge and validate the layers once per run
#   ship_require_gate          the merged config has a non-empty string `gate`
#   ship_cfg_get <dotted.key>  print one value (strings raw, others compact JSON);
#                              returns 3 when the key is unset (null or absent)
#   ship_cfg_print             print every leaf key, its value and its source file
#
# Preflight (ship-loop --preflight) must check `hyper` on PATH unless
# SHIP_SPACE_ROOT is set, plus ship_require_yq and ship_require_gate.
#
# Verdicts
#   validate_verdict <schema> <file>   jq-only check of a verdict file against a
#                                      schema in scripts/ship/schemas/ (see the end)
#
# Models
#   ship_model_parse <model>           print "harness<TAB>provider<TAB>model<TAB>thinking"
#   ship_models_override <stage=a,b>   replace one stage's model list in the loaded config
#
# Quota (preflight routing; see the end of this file)
#   ship_quota_dir             ${SHIP_QUOTA_DIR:-~/.cache/hyper/quota}
#   ship_quota_account         the claude account name: CLAUDE_CONFIG_DIR, sanitised, or "default"
#   pick_model [--dry] <list key> [agent [stage [round]]]
#                              walk models.<key>, skip what preflight rules out
#
# Layers, lowest to highest precedence:
#   skills/ship/defaults.yml  <  ~/.config/hyper/ship.yml  <  <space root>/.hyper/ship.yml
# Objects merge key-wise, arrays replace. Each file is read once with
# `yq -o=json` and merged with jq. The merged config is exported as
# SHIP_CONFIG_JSON (and the per-file data as SHIP_CONFIG_LAYERS) so child
# scripts of one run do not re-read the files. When SHIP_CONFIG_FILE names a
# merged-config JSON file, that file is the config and no layer is read (host mode).

# _ship_self_dir <path> — physical directory of a script, following symlinks.
# Portable to bash 3.2 and BSD readlink (no readlink -f).
_ship_self_dir() {
  local src="$1" dir link
  while [[ -L "$src" ]]; do
    case "$src" in */*) dir="${src%/*}" ;; *) dir="." ;; esac
    link="$(readlink "$src")"
    case "$link" in /*) src="$link" ;; *) src="$dir/$link" ;; esac
  done
  case "$src" in */*) dir="${src%/*}" ;; *) dir="." ;; esac
  CDPATH='' cd -- "$dir" && pwd -P
}

if [[ -z "${SHIP_PLUGIN_ROOT:-}" ]]; then
  _ship_lib_dir="$(_ship_self_dir "${BASH_SOURCE[0]}")"
  SHIP_PLUGIN_ROOT="${_ship_lib_dir%/scripts/ship}"
  unset _ship_lib_dir
fi
SHIP_DEFAULTS_FILE="$SHIP_PLUGIN_ROOT/skills/ship/defaults.yml"

# Stages that carry a model list.
SHIP_STAGES="dev verify review spec_check spec_write final"

_ship_err() { echo "ship: $*" >&2; }

# ship_require_yq — mikefarah yq v4 is the only supported yq.
ship_require_yq() {
  local out
  if ! command -v yq >/dev/null 2>&1; then
    _ship_err "yq is required (mikefarah yq v4: https://github.com/mikefarah/yq) but was not found on PATH"
    return 1
  fi
  out="$(yq --version 2>&1)" || out=""
  case "$out" in
    *mikefarah/yq*" version v4."*|*mikefarah/yq*" version 4."*) return 0 ;;
  esac
  _ship_err "yq on PATH is not mikefarah yq v4 (yq --version said: ${out:-nothing})"
  return 1
}

# ship_space_root — see the header. The hyper CLI owns space detection; hosts
# without it (or with an outdated one) set SHIP_SPACE_ROOT instead.
ship_space_root() {
  if [[ -n "${SHIP_SPACE_ROOT:-}" ]]; then
    local r="$SHIP_SPACE_ROOT"
    while [[ "$r" == */ && "$r" != / ]]; do r="${r%/}"; done
    if [[ ! -d "$r" ]]; then
      _ship_err "SHIP_SPACE_ROOT=$SHIP_SPACE_ROOT is not a directory"
      return 2
    fi
    CDPATH='' cd -- "$r" && pwd -P
    return
  fi
  # shellcheck source=../hyper-require-lib.sh
  source "$SHIP_PLUGIN_ROOT/scripts/hyper-require-lib.sh"
  local out rc=0
  # A subshell, because hyper-lib.sh turns on errexit and pipefail when sourced.
  out="$(
    if ! hyper_soft_lib 2>/dev/null; then
      echo "ship-reason:${hyper_lib_reason:-missing}"
      exit 2
    fi
    find_space_root "$PWD"
  )" || rc=$?
  if [[ $rc -eq 2 ]]; then
    _ship_err "cannot locate the space root: hyper CLI missing or outdated (${out#ship-reason:}); install @hypercli/cli or set SHIP_SPACE_ROOT"
    return 2
  fi
  [[ $rc -eq 0 && -n "$out" ]] || return 1
  printf '%s\n' "$out"
}

# ship_project — the project name: the space root's directory name.
ship_project() {
  local root
  root="$(ship_space_root)" || return $?
  printf '%s\n' "${root##*/}"
}

# _ship_layer_json <file> — the file as a JSON object on stdout.
_ship_layer_json() {
  local f="$1" json kind count errf
  errf="$(mktemp "${TMPDIR:-/tmp}/ship-yq.XXXXXX")" || return 1
  # stderr stays out of the JSON: yq warns (exit 0) on merge keys and the like.
  if ! json="$(yq -o=json '.' "$f" 2>"$errf")"; then
    _ship_err "cannot parse $f: $(cat "$errf")"
    rm -f "$errf"
    return 1
  fi
  rm -f "$errf"
  count="$(printf '%s' "$json" | jq -s 'length' 2>/dev/null)" || {
    _ship_err "cannot parse $f: yq produced invalid JSON"
    return 1
  }
  if [[ "$count" -gt 1 ]]; then
    _ship_err "cannot parse $f: multiple YAML documents (a ship config is one document)"
    return 1
  fi
  [[ "$count" -eq 0 ]] && { printf '{}'; return 0; }
  kind="$(printf '%s' "$json" | jq -r 'type')"
  case "$kind" in
    object) printf '%s' "$json" ;;
    null)   printf '{}' ;;
    *)      _ship_err "$f must be a YAML mapping at the top level, not a $kind"; return 1 ;;
  esac
}

# _ship_cfg_type <dotted.key> — jq type of the key in the merged config.
_ship_cfg_type() {
  jq -r --arg k "$1" 'try getpath($k | split(".")) catch null | type' <<<"$SHIP_CONFIG_JSON"
}

# _ship_key_src <dotted.key> — the layer file that decided the key's value: the
# last layer that sets it, or sets one of its parents to a non-mapping.
_ship_key_src() {
  jq -r --arg k "$1" '
    ($k | split(".")) as $p
    | def has_path($d; $q): any($d | path(..); . == $q);
      def overrides($d):
        has_path($d; $p)
        or any(range(1; $p | length);
               ($p[:.]) as $q
               | has_path($d; $q) and (($d | getpath($q) | type) != "object"));
    (map(select(overrides(.data))) | last | .file) // .[0].file
  ' <<<"$SHIP_CONFIG_LAYERS"
}

# _ship_validate_models <dotted.key> — non-empty array of valid model names.
_ship_validate_models() {
  local key="$1" t n i m err bad=0
  t="$(_ship_cfg_type "$key")"
  if [[ "$t" != array ]]; then
    _ship_err "$key must be a non-empty list of models (got $t); set in $(_ship_key_src "$key")"
    return 1
  fi
  n="$(jq -r --arg k "$key" 'getpath($k | split(".")) | length' <<<"$SHIP_CONFIG_JSON")"
  if [[ "$n" -eq 0 ]]; then
    _ship_err "$key must be a non-empty list of models; set in $(_ship_key_src "$key")"
    return 1
  fi
  for ((i = 0; i < n; i++)); do
    if [[ "$(jq -r --arg k "$key" --argjson i "$i" 'getpath($k | split(".")) | .[$i] | type' <<<"$SHIP_CONFIG_JSON")" != string ]]; then
      _ship_err "$key entry $((i + 1)) is not a string; set in $(_ship_key_src "$key")"
      bad=1; continue
    fi
    m="$(jq -r --arg k "$key" --argjson i "$i" 'getpath($k | split(".")) | .[$i]' <<<"$SHIP_CONFIG_JSON")"
    if ! err="$(ship_model_parse "$m" 2>&1 >/dev/null)"; then
      _ship_err "${err#ship: } (in $key; set in $(_ship_key_src "$key"))"
      bad=1
    fi
  done
  return $bad
}

# _ship_validate_config — shape checks on the merged config; names the key and
# the layer file it came from.
_ship_validate_config() {
  local bad=0 s k
  for s in $SHIP_STAGES; do
    _ship_validate_models "models.$s" || bad=1
  done
  _ship_validate_models failover.summarizer || bad=1
  for k in max_rounds budgets.S budgets.M budgets.L budgets.fix_fraction budgets.check; do
    if [[ "$(_ship_cfg_type "$k")" != number ]]; then
      _ship_err "$k must be a number (got $(_ship_cfg_type "$k")); set in $(_ship_key_src "$k")"
      bad=1
    fi
  done
  return $bad
}

# ship_require_gate — `gate` has no default; callers that run it (finalize,
# land) require it. Everything else (ship-role, ship-mux, --abandon) does not.
ship_require_gate() {
  local t
  t="$(_ship_cfg_type gate)"
  case "$t" in
    string)
      jq -e '.gate | length > 0' <<<"$SHIP_CONFIG_JSON" >/dev/null && return 0
      _ship_err "gate must be a non-empty string (got an empty string)" ;;
    null)
      _ship_err "required key 'gate' is not set. Set it in <space root>/.hyper/ship.yml (or ~/.config/hyper/ship.yml): the shell command that must pass before push and merge" ;;
    *)
      _ship_err "gate must be a non-empty string (got $t)" ;;
  esac
  return 1
}

# ship_config_load — build SHIP_CONFIG_LAYERS and SHIP_CONFIG_JSON. A second call
# in the same run (or in a child that inherited the exports) is a no-op.
ship_config_load() {
  if [[ -n "${SHIP_CONFIG_JSON:-}" && -n "${SHIP_CONFIG_LAYERS:-}" ]]; then
    return 0
  fi
  # SHIP_CONFIG_FILE: a merged config the lead resolved on another machine (host mode
  # writes it to notes/loops/<ref>/config.json). It replaces the layers; nothing is
  # re-resolved here.
  if [[ -n "${SHIP_CONFIG_FILE:-}" ]]; then
    command -v jq >/dev/null 2>&1 || { _ship_err "jq is required but was not found on PATH"; return 1; }
    SHIP_CONFIG_JSON="$(jq -c . "$SHIP_CONFIG_FILE" 2>/dev/null)" && [[ -n "$SHIP_CONFIG_JSON" ]] \
      || { _ship_err "cannot read the lead's config $SHIP_CONFIG_FILE"; unset SHIP_CONFIG_JSON; return 1; }
    SHIP_CONFIG_LAYERS="$(jq -nc --arg f "$SHIP_CONFIG_FILE" '[{file: $f, data: {}}]')"
    export SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
    return 0
  fi
  ship_require_yq || return 1
  command -v jq >/dev/null 2>&1 || { _ship_err "jq is required but was not found on PATH"; return 1; }

  local files=("$SHIP_DEFAULTS_FILE") root="" layers="[]" f data rc=0
  [[ -f "$SHIP_DEFAULTS_FILE" ]] || { _ship_err "missing defaults file $SHIP_DEFAULTS_FILE"; return 1; }
  [[ -n "${HOME:-}" && -f "$HOME/.config/hyper/ship.yml" ]] && files+=("$HOME/.config/hyper/ship.yml")
  root="$(ship_space_root)" || rc=$?
  # 2 = cannot tell (already reported); 1 = not in a space, so no project layer.
  [[ $rc -eq 2 ]] && return 1
  [[ $rc -eq 0 && -f "$root/.hyper/ship.yml" ]] && files+=("$root/.hyper/ship.yml")

  for f in "${files[@]}"; do
    data="$(_ship_layer_json "$f")" || return 1
    layers="$(jq -c --arg file "$f" --argjson data "$data" '. + [{file: $file, data: $data}]' <<<"$layers")" || return 1
  done

  local merged
  merged="$(jq -c '[.[].data] | reduce .[] as $l ({}; . * $l)' <<<"$layers")" || return 1
  # <project> in units_group is the space directory name, when there is a space.
  if [[ $rc -eq 0 && -n "$root" ]]; then
    merged="$(jq -c --arg p "${root##*/}" 'if (.units_group | type) == "string" then .units_group |= gsub("<project>"; $p) else . end' <<<"$merged")" || return 1
  fi

  SHIP_CONFIG_LAYERS="$layers"
  SHIP_CONFIG_JSON="$merged"
  _ship_validate_config || { unset SHIP_CONFIG_LAYERS SHIP_CONFIG_JSON; return 1; }
  export SHIP_CONFIG_LAYERS SHIP_CONFIG_JSON
}

# ship_cfg_get <dotted.key> — value on stdout. Returns 3 when the key is unset
# (null or absent); an empty string is a value and prints an empty line.
ship_cfg_get() {
  local key="${1:?ship_cfg_get: key required}" out
  out="$(jq -r --arg k "$key" 'try getpath($k | split(".")) catch null | if . == null then "U" elif type == "string" then "S" + . else "J" + tojson end' <<<"$SHIP_CONFIG_JSON")" || return 1
  case "$out" in
    U) return 3 ;;
    [SJ]*) printf '%s\n' "${out#?}" ;;
    *) return 1 ;;
  esac
}

# ship_cfg_print — "key = json  # source file" per leaf. Arrays and empty
# objects are leaves; the source is the highest layer that sets the key.
ship_cfg_print() {
  jq -r --argjson m "$SHIP_CONFIG_JSON" '
    def lp($p):
      if type == "object" and length > 0
      then . as $o | ($o | keys_unsorted[]) as $k | $o[$k] | lp($p + [$k])
      else $p end;
    . as $layers
    | ($layers | map({file, keys: [.data | lp([]) | join(".")]})) as $idx
    | ($m | lp([])) as $p
    | ($p | join(".")) as $k
    | ($idx | map(select(.keys | any(. == $k))) | last | .file) as $src
    | "\($k) = \($m | getpath($p) | tojson)  # \($src // "override")"
  ' <<<"$SHIP_CONFIG_LAYERS"
}

# ship_model_parse <model> — "harness<TAB>provider<TAB>model<TAB>thinking".
#   <name>                    -> claude  <empty>  <name>  <empty>
#   zai/glm-5.3               -> pi      zai      glm-5.3 <empty>
#   zai/glm-5.3:high          -> pi      zai      glm-5.3 high
# The provider is everything before the first slash; the thinking level is
# everything after the last colon of the remainder.
ship_model_parse() {
  local m="${1-}" provider rest model thinking=""
  if [[ -z "$m" || "$m" == *[[:space:]]* ]]; then
    _ship_err "invalid model '$m': empty or contains whitespace"
    return 1
  fi
  if [[ "$m" != */* ]]; then
    if [[ "$m" == *:* ]]; then
      _ship_err "invalid model '$m': a bare Claude name takes no ':thinking' suffix"
      return 1
    fi
    printf 'claude\t\t%s\t\n' "$m"
    return 0
  fi
  provider="${m%%/*}"
  rest="${m#*/}"
  model="$rest"
  if [[ "$rest" == *:* ]]; then
    model="${rest%:*}"
    thinking="${rest##*:}"
  fi
  if [[ -z "$provider" || -z "$model" || ( "$rest" == *:* && -z "$thinking" ) ]]; then
    _ship_err "invalid model '$m': expected provider/model[:thinking]"
    return 1
  fi
  printf 'pi\t%s\t%s\t%s\n' "$provider" "$model" "$thinking"
}

# ship_models_override <stage=a,b> — replace models.<stage> in the loaded config.
ship_models_override() {
  local spec="${1-}" stage list m models=() json
  if [[ "$spec" != *=* ]]; then
    _ship_err "invalid model override '$spec': expected stage=model[,model...]"
    return 1
  fi
  stage="${spec%%=*}"
  list="${spec#*=}"
  case " $SHIP_STAGES " in
    *" $stage "*) ;;
    *) _ship_err "invalid model override '$spec': unknown stage '$stage' (stages: $SHIP_STAGES)"; return 1 ;;
  esac
  if [[ -z "$list" ]]; then
    _ship_err "invalid model override '$spec': empty model list"
    return 1
  fi
  local IFS=,
  read -r -a models <<<"$list"
  IFS=$' \t\n'
  for m in "${models[@]}"; do
    ship_model_parse "$m" >/dev/null || return 1
  done
  json="$(printf '%s\n' "${models[@]}" | jq -R . | jq -sc .)"
  SHIP_CONFIG_JSON="$(jq -c --arg s "$stage" --argjson l "$json" '.models[$s] = $l' <<<"$SHIP_CONFIG_JSON")" || return 1
  export SHIP_CONFIG_JSON
}

# Verdict validation
#   validate_verdict <schema> <file>   check one agent or driver JSON file against
#                                      a schema in scripts/ship/schemas/. jq only.
#                                      Returns 0 when valid, 1 when not (every
#                                      problem on stderr, one per line), 2 on
#                                      usage errors (missing or unreadable file,
#                                      invalid JSON). A file holding zero or
#                                      several JSON values is invalid (1).
#
# Cross-field rules are not checked here: "GAP needs a non-empty gaps" and
# "REMOVE needs a non-empty removals" are left to the driver (ship-loop).
#
# The schema dialect is the JSON Schema subset the schemas use: type (a name or a
# list of names; "integer" and "number" both accept whole numbers), enum,
# required, properties, items. Keys the schema does not name are allowed.
_SHIP_VALIDATE_JQ='
  def tname: if type == "number" then (if . == floor then "integer" else "number" end) else type end;
  def tmatch($t):
    tname as $n
    | ($t | if type == "array" then . else [.] end)
    | any(.[]; . == $n or (. == "number" and $n == "integer"));
  def chk($s; $p):
    . as $v
    | (if ($s.type? // null) != null and ($v | tmatch($s.type) | not)
       then "\($p): expected \($s.type | tostring), got \($v | tname)" else empty end),
      (if ($s.enum? // null) != null and ($s.enum | index([$v]) | not)
       then "\($p): \($v | tojson) is not one of \($s.enum | map(tojson) | join(", "))" else empty end),
      (if ($v | type) == "object" then
         (($s.required? // [])[] as $k | select($v | has($k) | not) | "\($p): missing required key \($k)"),
         (($s.properties? // {}) | to_entries[] | select(.key as $k | $v | has($k))
            | . as $e | $v[$e.key] | chk($e.value; "\($p).\($e.key)"))
       else empty end),
      (if ($v | type) == "array" and ($s.items? // null) != null then
         range(0; $v | length) as $i | $v[$i] | chk($s.items; "\($p)[\($i)]")
       else empty end);
  chk($s[0]; "$")
'

validate_verdict() {
  local schema="${1:-}" file="${2:-}" errs line
  if [[ -z "$schema" || -z "$file" ]]; then
    _ship_err "usage: validate_verdict <schema> <file>"
    return 2
  fi
  if [[ ! -f "$schema" ]]; then
    _ship_err "validate_verdict: schema not found: $schema"
    return 2
  fi
  if [[ ! -f "$file" ]]; then
    _ship_err "validate_verdict: file not found: $file"
    return 2
  fi
  command -v jq >/dev/null 2>&1 || { _ship_err "jq is required but was not found on PATH"; return 2; }
  if ! jq -e . "$schema" >/dev/null 2>&1; then
    _ship_err "validate_verdict: schema is not valid JSON: $schema"
    return 2
  fi
  if ! jq empty "$file" >/dev/null 2>&1; then
    _ship_err "validate_verdict: not valid JSON: $file"
    return 2
  fi
  if [[ "$(jq -s length "$file" 2>/dev/null)" != 1 ]]; then
    _ship_err "validate_verdict: $file: expected exactly one JSON value"
    return 1
  fi
  errs="$(jq -r --slurpfile s "$schema" "$_SHIP_VALIDATE_JQ" "$file" 2>&1)" || {
    _ship_err "validate_verdict: validator failed on $file: $errs"
    return 2
  }
  if [[ -n "$errs" ]]; then
    while IFS= read -r line; do
      _ship_err "$(basename "$file") does not match $(basename "$schema"): $line"
    done <<<"$errs"
    return 1
  fi
  return 0
}

# Quota and preflight routing
#
# The quota tap (ship-quota-tap) writes <quota dir>/claude-<account>.json:
#   {"account": A, "at": ISO-8601 UTC, "rate_limits": {"five_hour": {"used_percentage",
#    "resets_at"}, "seven_day": {...}}}
# Reactive failover (ship_limit_record below) writes <quota dir>/limited.json:
#   {"accounts": {A: {"until": T}}, "models": {M: {"until": T}}}
# where T is epoch seconds or ISO-8601 and M is a model as written in a list.
# Times in either file may be epoch seconds or ISO-8601; milliseconds are accepted.

ship_quota_dir() { printf '%s' "${SHIP_QUOTA_DIR:-$HOME/.cache/hyper/quota}"; }

# ship_quota_account — the account the claude agents of this run use.
ship_quota_account() {
  local a="${CLAUDE_CONFIG_DIR:-}"
  [[ -n "$a" ]] || { printf 'default'; return 0; }
  printf '%s' "$a" | sed 's/[^A-Za-z0-9._-]/_/g'
}

# jq prelude shared by the quota readers: epoch seconds from a number or an ISO string.
_SHIP_EPOCH_JQ='
  def epoch: if type == "number" then (if . > 100000000000 then . / 1000 | floor else . end)
             elif type == "string" then (try fromdateiso8601 catch (tonumber? // null))
             else null end;
'

# _ship_pick_log <message> — loop.log line when the caller defines `log`, else stderr.
_ship_pick_log() {
  if declare -F log >/dev/null 2>&1; then log "$1"; else echo "$1" >&2; fi
}

# pick_model [--dry] <list key> [agent [stage [round]]] — the first usable entry of models.<key>.
#
# Sets PICK_MODEL (empty when none is usable) and PICK_RESETS_AT (epoch seconds; the earliest
# moment an entry becomes usable again, empty when unknown). Prints nothing; call it in the
# current shell, not in $( ).
# Returns 0 an entry was picked; 2 every entry was skipped; 1 error (no such list).
#
# Walks the list in order (design: usage limits, preflight routing):
#   - a claude entry is skipped when its account or model is in limited.json with `until` in the future;
#   - a claude entry is skipped when the account snapshot is younger than quota.max_age_min and
#     five_hour or seven_day used_percentage is at or above quota.threshold_pct and that window's
#     resets_at is in the future (no snapshot, a stale one, or a window that already reset: no skip);
#   - a pi entry (provider/model) is never skipped here.
# PICK_AFTER, when set to an entry of the list, starts the walk after that entry (reactive failover: the
# next model after the one that hit a limit).
# Unless --dry, each skip writes $STATE/failover-N.json (reason preflight) and logs one line. $STATE
# unset means nothing is written. agent, stage and round fill the record (stage defaults to the key).
# shellcheck disable=SC2034  # PICK_MODEL and PICK_RESETS_AT are read by the caller
pick_model() {
  local dry=0 key agent stage round list n i m now account qdir snap lim maxage thr
  local quota lim_json entries skip_json skipped='[]' blocked picked="" until_ts
  if [[ "${1-}" == --dry ]]; then dry=1; shift; fi
  key="${1-}" agent="${2-}" stage="${3:-${1-}}" round="${4:-0}"
  PICK_MODEL="" PICK_RESETS_AT=""
  [[ -n "$key" ]] || { _ship_err "pick_model: a model list key is required"; return 1; }
  list="$(jq -c --arg k "$key" '.models[$k] // empty' <<<"${SHIP_CONFIG_JSON:-null}" 2>/dev/null)"
  n="$(jq -r 'length' <<<"${list:-[]}")"
  [[ -n "$list" && "$n" -gt 0 ]] || { _ship_err "pick_model: models.$key is empty or unset"; return 1; }

  now="$(date +%s)"
  account="$(ship_quota_account)"
  qdir="$(ship_quota_dir)"
  snap="$qdir/claude-$account.json"
  lim="$qdir/limited.json"
  maxage="$(jq -r '.quota.max_age_min // 30' <<<"$SHIP_CONFIG_JSON")"
  thr="$(jq -r '.quota.threshold_pct // 95' <<<"$SHIP_CONFIG_JSON")"

  # The account's quota block: null, or {five_hour, seven_day, resets_at (epoch), window}.
  quota=null
  if [[ -s "$snap" ]]; then
    quota="$(jq -c --argjson now "$now" --argjson maxage "$maxage" --argjson thr "$thr" "$_SHIP_EPOCH_JQ"'
      (.at | epoch) as $at
      | if $at == null or ($now - $at) > ($maxage * 60) then null
        else
          [ ("five_hour", "seven_day") as $w
            | (.rate_limits // {})[$w]? | select(type == "object")
            | select((.used_percentage | type) == "number" and .used_percentage >= $thr)
            | (.resets_at | epoch) as $r | select($r != null and $r > $now)
            | {w: $w, r: $r} ] as $hits
          | if ($hits | length) == 0 then null
            else {five_hour: (.rate_limits.five_hour.used_percentage // null),
                  seven_day: (.rate_limits.seven_day.used_percentage // null),
                  resets_at: ($hits | map(.r) | max), window: ($hits | map(.w) | join("+"))}
                 | with_entries(select(.value != null))
            end
        end' "$snap" 2>/dev/null)" || quota=null
    [[ -n "$quota" ]] || quota=null
  fi

  lim_json='{}'
  if [[ -s "$lim" ]]; then lim_json="$(jq -c . "$lim" 2>/dev/null)" || lim_json='{}'; [[ -n "$lim_json" ]] || lim_json='{}'; fi

  i=0
  if [[ -n "${PICK_AFTER:-}" ]]; then
    i="$(jq -r --arg m "$PICK_AFTER" '(index($m) // -1) + 1' <<<"$list")"
  fi
  while [[ $i -lt $n ]]; do
    m="$(jq -r --argjson i "$i" '.[$i]' <<<"$list")"
    i=$((i + 1))
    if [[ "$(ship_model_parse "$m" 2>/dev/null | cut -f1)" != claude ]]; then picked="$m"; break; fi
    # blocked: empty when usable; else JSON {why, kind (account|model), until, quota?}
    blocked="$(jq -nc --argjson now "$now" --argjson lim "$lim_json" --argjson q "$quota" \
      --arg acct "$account" --arg m "$m" "$_SHIP_EPOCH_JQ"'
      ([($lim.accounts[$acct].until? | epoch)] | map(select(. != null and . > $now))) as $la
      | ([($lim.models[$m].until? | epoch)] | map(select(. != null and . > $now))) as $lm
      | ($la + $lm) as $l
      | if ($l | length) > 0 then {why: "limited.json", kind: (if ($la | length) > 0 then "account" else "model" end), until: ($l | max)}
        elif $q != null then {why: ("\($q.window) at or above the threshold"), kind: "account", until: $q.resets_at, quota: ($q | del(.window))}
        else empty end')" || blocked=""
    if [[ -z "$blocked" ]]; then picked="$m"; break; fi
    skipped="$(jq -c --arg m "$m" --argjson b "$blocked" '. + [$b + {from: $m}]' <<<"$skipped")"
  done

  PICK_MODEL="$picked"
  if [[ -z "$picked" ]]; then
    PICK_RESETS_AT="$(jq -r '[.[].until] | min // empty' <<<"$skipped")"
  fi
  if [[ "$dry" -eq 1 ]]; then
    [[ -n "$picked" ]] && return 0
    return 2
  fi

  # One failover-N.json per skip; `to` is the next entry of the list (empty past the end).
  entries="$(jq -c --argjson l "$list" \
    'map(.from as $f | . + {to: (($l | index($f)) as $x | if $x == null then "" else ($l[$x + 1] // "") end)})' \
    <<<"$skipped" 2>/dev/null)" || entries='[]'
  [[ -n "$entries" ]] || entries='[]'
  local k=0 cnt idx rec
  cnt="$(jq -r 'length' <<<"$entries")"
  while [[ $k -lt "$cnt" ]]; do
    skip_json="$(jq -c --argjson k "$k" '.[$k]' <<<"$entries")"
    k=$((k + 1))
    until_ts="$(jq -r '.until' <<<"$skip_json")"
    _ship_pick_log "FAILOVER preflight $stage: $(jq -r .from <<<"$skip_json") skipped ($(jq -r .why <<<"$skip_json"); usable again $(jq -nr --argjson t "$until_ts" '$t | todate'))${agent:+ for $agent} -> $(jq -r '.to | if . == "" then "nothing left" else . end' <<<"$skip_json")"
    [[ -n "${STATE:-}" ]] || continue
    idx=1
    while [[ -e "$STATE/failover-$idx.json" ]]; do idx=$((idx + 1)); done
    rec="$(jq -nc --argjson s "$skip_json" --arg stage "$stage" --argjson round "$round" --arg agent "$agent" \
      --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{stage:$stage, round:$round, agent:$agent, from:$s.from, to:$s.to, reason:"preflight", limit_kind:$s.kind,
        matched:null, summarizer:null, status_md:null, at:$at} + (if $s.quota then {quota:$s.quota} else {} end)')"
    printf '%s\n' "$rec" >"$STATE/failover-$idx.json.tmp" && mv "$STATE/failover-$idx.json.tmp" "$STATE/failover-$idx.json"
  done
  [[ -n "$picked" ]] || return 2
  return 0
}

# ship_quota_block — print {five_hour, seven_day, resets_at} (epoch) from the account's snapshot when it is
# younger than quota.max_age_min; nothing otherwise. resets_at is the latest future resets_at among the
# windows at 100%, else among those at or above quota.threshold_pct, else the window with the highest
# used_percentage (a snapshot taken a little before the limit), and absent when that has already reset.
ship_quota_block() {
  local snap now maxage thr cfgj
  snap="$(ship_quota_dir)/claude-$(ship_quota_account).json"
  [[ -s "$snap" ]] || return 0
  now="$(date +%s)"
  cfgj="${SHIP_CONFIG_JSON:-}"; [[ -n "$cfgj" ]] || cfgj='{}'
  maxage="$(jq -r '.quota.max_age_min // 30' <<<"$cfgj" 2>/dev/null)"; [[ -n "$maxage" ]] || maxage=30
  thr="$(jq -r '.quota.threshold_pct // 95' <<<"$cfgj" 2>/dev/null)"; [[ -n "$thr" ]] || thr=95
  jq -c --argjson now "$now" --argjson maxage "$maxage" --argjson thr "$thr" "$_SHIP_EPOCH_JQ"'
    (.at | epoch) as $at
    | if $at == null or ($now - $at) > ($maxage * 60) then empty
      else
        (.rate_limits // {}) as $rl
        | def hits($min): [("five_hour", "seven_day") as $w | $rl[$w]? | select(type == "object")
            | select((.used_percentage | type) == "number" and .used_percentage >= $min)
            | (.resets_at | epoch) | select(. != null and . > $now)];
          ((hits(100) | max) // (hits($thr) | max)
            // ([("five_hour", "seven_day") as $w | $rl[$w]? | select(type == "object" and (.used_percentage | type) == "number")
                 | {u: .used_percentage, r: (.resets_at | epoch)}] | sort_by(.u) | last | .r? | select(. != null and . > $now))) as $r
        | {five_hour: ($rl.five_hour.used_percentage? // null), seven_day: ($rl.seven_day.used_percentage? // null), resets_at: $r}
        | with_entries(select(.value != null))
      end' "$snap" 2>/dev/null
  return 0
}

# _ship_lock <file> — take <file>.lock (a directory: mkdir is atomic on every platform, flock is not on
# macOS). Retries for about 10 s, then breaks a lock older than 60 s. 1 when it cannot be taken.
_ship_lock() {
  local l="$1.lock" i=0 age
  while ! mkdir "$l" 2>/dev/null; do
    i=$((i + 1))
    if [[ $i -gt 200 ]]; then
      age=$(( $(date +%s) - $(stat -c %Y "$l" 2>/dev/null || stat -f %m "$l" 2>/dev/null || echo 0) ))
      if [[ $age -gt 60 ]]; then rmdir "$l" 2>/dev/null; i=0; continue; fi
      return 1
    fi
    sleep 0.05
  done
}
_ship_unlock() { rmdir "$1.lock" 2>/dev/null || true; }

# ship_limit_record <account|model> <key> <until epoch> — add an entry to limited.json (the file pick_model
# reads), atomically and under a lock, keeping the entries other units wrote.
ship_limit_record() {
  local f cur tmp rc=0
  f="$(ship_quota_dir)/limited.json"
  mkdir -p "$(dirname "$f")" || return 1
  _ship_lock "$f" || { _ship_err "limited.json is locked"; return 1; }
  cur='{}'
  if [[ -s "$f" ]]; then cur="$(jq -c 'if type == "object" then . else {} end' "$f" 2>/dev/null)" || cur='{}'; [[ -n "$cur" ]] || cur='{}'; fi
  tmp="$f.tmp.$$"
  jq -c --arg k "$1" --arg key "$2" --argjson u "$3" \
    '(if $k == "account" then "accounts" else "models" end) as $c | .[$c] = ((.[$c] // {}) + {($key): {until: $u}})' <<<"$cur" >"$tmp" \
    && mv -f "$tmp" "$f" || rc=1
  rm -f "$tmp"
  _ship_unlock "$f"
  return $rc
}

# ship_limit_clear <name> — remove an account or a model named <name> from limited.json (the lead's way to say
# the quota is back). 0 also when there was nothing to remove.
ship_limit_clear() {
  local f cur tmp rc=0
  f="$(ship_quota_dir)/limited.json"
  [[ -s "$f" ]] || return 0
  _ship_lock "$f" || { _ship_err "limited.json is locked"; return 1; }
  cur="$(jq -c 'if type == "object" then . else {} end' "$f" 2>/dev/null)" || cur='{}'
  tmp="$f.tmp.$$"
  jq -c --arg n "$1" 'del(.accounts[$n]?) | del(.models[$n]?)' <<<"$cur" >"$tmp" && mv -f "$tmp" "$f" || rc=1
  rm -f "$tmp"
  _ship_unlock "$f"
  return $rc
}
