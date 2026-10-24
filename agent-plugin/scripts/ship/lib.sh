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
#   ship_space_root            print the enclosing space root, or return 1
#   ship_config_load           load and merge the config layers once per run
#   ship_cfg_get <dotted.key>  print one value (strings raw, others compact JSON)
#   ship_cfg_print             print every leaf key, its value and its source file
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
# scripts of one run do not re-read the files.

if [[ -z "${SHIP_PLUGIN_ROOT:-}" ]]; then
  _ship_lib_dir="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
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

# ship_space_root — the enclosing space root of $PWD. Needs the hyper CLI, which
# owns space detection. Returns 1 when cwd is not inside a space.
ship_space_root() {
  # shellcheck source=../hyper-require-lib.sh
  source "$SHIP_PLUGIN_ROOT/scripts/hyper-require-lib.sh"
  # A subshell, because hyper-lib.sh turns on errexit and pipefail when sourced.
  ( hyper_soft_lib 2>/dev/null && find_space_root "$PWD" )
}

# _ship_layer_json <file> — the file as a JSON object on stdout.
_ship_layer_json() {
  local f="$1" json kind
  if ! json="$(yq -o=json '.' "$f" 2>&1)"; then
    _ship_err "cannot parse $f: $json"
    return 1
  fi
  kind="$(printf '%s' "$json" | jq -r 'type' 2>/dev/null)" || {
    _ship_err "cannot parse $f: yq produced invalid JSON"
    return 1
  }
  case "$kind" in
    object) printf '%s' "$json" ;;
    null)   printf '{}' ;;
    *)      _ship_err "$f must be a YAML mapping at the top level, not a $kind"; return 1 ;;
  esac
}

# ship_config_load — build SHIP_CONFIG_LAYERS and SHIP_CONFIG_JSON. A second call
# in the same run (or in a child that inherited the exports) is a no-op.
ship_config_load() {
  if [[ -n "${SHIP_CONFIG_JSON:-}" && -n "${SHIP_CONFIG_LAYERS:-}" ]]; then
    return 0
  fi
  ship_require_yq || return 1
  command -v jq >/dev/null 2>&1 || { _ship_err "jq is required but was not found on PATH"; return 1; }

  local files=("$SHIP_DEFAULTS_FILE") root layers="[]" f data
  [[ -f "$SHIP_DEFAULTS_FILE" ]] || { _ship_err "missing defaults file $SHIP_DEFAULTS_FILE"; return 1; }
  [[ -f "$HOME/.config/hyper/ship.yml" ]] && files+=("$HOME/.config/hyper/ship.yml")
  if root="$(ship_space_root)" && [[ -n "$root" && -f "$root/.hyper/ship.yml" ]]; then
    files+=("$root/.hyper/ship.yml")
  fi

  for f in "${files[@]}"; do
    data="$(_ship_layer_json "$f")" || return 1
    layers="$(jq -c --arg file "$f" --argjson data "$data" '. + [{file: $file, data: $data}]' <<<"$layers")" || return 1
  done

  local merged
  merged="$(jq -c '[.[].data] | reduce .[] as $l ({}; . * $l)' <<<"$layers")" || return 1

  if ! jq -e '(.gate | type) == "string" and (.gate | length) > 0' <<<"$merged" >/dev/null; then
    _ship_err "required key 'gate' is not set. Set it in <space root>/.hyper/ship.yml (or ~/.config/hyper/ship.yml): the shell command that must pass before push and merge"
    return 1
  fi

  SHIP_CONFIG_LAYERS="$layers"
  SHIP_CONFIG_JSON="$merged"
  export SHIP_CONFIG_LAYERS SHIP_CONFIG_JSON
}

# ship_cfg_get <dotted.key> — value on stdout; return 1 when unset.
ship_cfg_get() {
  local key="${1:?ship_cfg_get: key required}" out
  out="$(jq -r --arg k "$key" 'getpath($k | split(".")) | if . == null then empty elif type == "string" then . else tojson end' <<<"$SHIP_CONFIG_JSON")" || return 1
  [[ -n "$out" ]] || return 1
  printf '%s\n' "$out"
}

# ship_cfg_print — "key = json  # source file" per leaf. Arrays and empty
# objects are leaves; the source is the highest layer that sets the key.
ship_cfg_print() {
  jq -r '
    def lp($p):
      if type == "object" and length > 0
      then . as $o | ($o | keys_unsorted[]) as $k | $o[$k] | lp($p + [$k])
      else $p end;
    . as $layers
    | ($layers | map(.data) | reduce .[] as $l ({}; . * $l)) as $m
    | ($layers | map({file, keys: [.data | lp([]) | join(".")]})) as $idx
    | ($m | lp([])) as $p
    | ($p | join(".")) as $k
    | ($idx | map(select(.keys | any(. == $k))) | last | .file) as $src
    | "\($k) = \($m | getpath($p) | tojson)  # \($src)"
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
