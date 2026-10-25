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
