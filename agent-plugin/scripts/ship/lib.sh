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
#                              the hyper CLI's find_space_root (answered from the
#                              filesystem, without spawning the CLI, when cwd is
#                              in a plain bare space and `hyper` is on PATH).
#                              Returns 1 when cwd is not in a space, 2 when the
#                              hyper CLI is missing or outdated and
#                              SHIP_SPACE_ROOT is unset.
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

# _ship_fs_space_root — the common case of find_space_root (packages/drive/scripts/hyper-lib.sh) answered
# from the filesystem, so that no node process starts: walk up from $PWD to the first directory that has a
# .git directory (a .git file is a linked worktree: keep walking) whose config says `bare = true` and that has
# worktrees/ or a HYPER.md/HYPERDEV.md beside it. Sets SHIP_FS_ROOT and returns 0 only when that answer is
# certain; anything else (no bare space found, a repo under code/ of a multi-repo space, a root that may be a
# multi-repo one, a config it cannot read with certainty) returns 1 and the CLI decides.
SHIP_FS_ROOT=""
_ship_fs_space_root() {
  local d="$PWD" cfg line section bare n parent gp
  SHIP_FS_ROOT=""
  [[ "$d" == /* ]] || return 1
  while [[ "$d" != / && -n "$d" ]]; do
    if [[ -d "$d/.git" ]]; then
      cfg="$d/.git/config"
      [[ -f "$cfg" ]] || return 1
      section="" bare="" n=0
      while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[[:space:]]*\[([A-Za-z0-9.-]+)([[:space:]]+\"[^\"]*\")?\][[:space:]]*(.*)$ ]]; then
          case "${BASH_REMATCH[1]}" in
            [Ii][Nn][Cc][Ll][Uu][Dd][Ee]*) return 1 ;;
            [Cc][Oo][Rr][Ee]) if [[ -z "${BASH_REMATCH[2]}" ]]; then section=core; else section=other; fi ;;   # [core "x"] is not [core]
            *) section=other ;;
          esac
        elif [[ "$section" == core && "$line" =~ ^[[:space:]]*[Bb][Aa][Rr][Ee][[:space:]]*=[[:space:]]*([^[:space:]#;]*)[[:space:]]*$ ]]; then
          bare="${BASH_REMATCH[1]}" n=$((n + 1))
        fi
      done <"$cfg"
      [[ $n -eq 1 && "$bare" == true ]] || return 1
      [[ -d "$d/worktrees" || -f "$d/HYPER.md" || -f "$d/HYPERDEV.md" ]] || return 1
      # a repo of a multi-repo space (<root>/code/<slug>): the CLI answers with the root, so leave it to the CLI
      parent="${d%/*}"
      if [[ "${parent##*/}" == code ]]; then
        gp="${parent%/*}"
        if [[ ! -e "$gp/.git" && ( -f "$gp/HYPER.md" || -f "$gp/HYPERDEV.md" ) && -d "$gp/code" ]]; then return 1; fi
      fi
      SHIP_FS_ROOT="$d"
      return 0
    elif [[ ! -e "$d/.git" && ( -f "$d/HYPER.md" || -f "$d/HYPERDEV.md" ) && -d "$d/code" ]]; then
      return 1   # a multi-repo root: leave it to the CLI
    fi
    d="${d%/*}"
  done
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
  if command -v hyper >/dev/null 2>&1 && _ship_fs_space_root; then
    printf '%s\n' "$SHIP_FS_ROOT"
    return 0
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

# _ship_layer_text <file> — the file as one compact JSON value per YAML document
# on stdout (nothing for an empty file). stderr is dropped: yq warns (exit 0) on
# merge keys and the like, and a failure is re-run by the caller to read why.
_ship_layer_text() { yq -o=json -I0 '.' "$1" 2>/dev/null; }

# _ship_cfg_type <dotted.key> — jq type of the key in the merged config.
_ship_cfg_type() {
  jq -r --arg k "$1" 'try getpath($k | split(".")) catch null | type' <<<"$SHIP_CONFIG_JSON"
}

# The merge + validation, one jq run per load. Input: none. Args: the layer files
# (positional) and $datas (their JSON, same order), $project
# (space directory name or ""), $stages. Output (raw): line 1 the layers array,
# line 2 the merged config, then one "ship: ..." line per validation problem.
_SHIP_LOAD_JQ='
  def ctype($k): try getpath($k | split(".")) catch null | type;
  def keysrc($layers; $k):
    ($k | split(".")) as $p
    | def has_path($d; $q): any($d | path(..); . == $q);
      def overrides($d):
        has_path($d; $p)
        or any(range(1; $p | length);
               ($p[:.]) as $q
               | has_path($d; $q) and (($d | getpath($q) | type) != "object"));
    ($layers | map(select(overrides(.data))) | last | .file) // $layers[0].file;
  # The reason a model name is invalid, or null. Mirrors ship_model_parse.
  def sq: [39] | implode;
  def model_err:
    if . == "" or test("\\s") then "invalid model \(sq)\(.)\(sq): empty or contains whitespace"
    elif (contains("/") | not) then
      if contains(":") then "invalid model \(sq)\(.)\(sq): a bare Claude name takes no \(sq):thinking\(sq) suffix" else null end
    else
      (split("/")) as $sp | $sp[0] as $prov | ($sp[1:] | join("/")) as $rest
      | (if ($rest | contains(":")) then ($rest | split(":")) else null end) as $c
      | (if $c then ($c[:-1] | join(":")) else $rest end) as $model
      | (if $c then $c[-1] else "" end) as $think
      | if $prov == "" or $model == "" or ($c != null and $think == "")
        then "invalid model \(sq)\(.)\(sq): expected provider/model[:thinking]" else null end
    end;
  def val_models($cfg; $layers; $key):
    ($cfg | ctype($key)) as $t
    | keysrc($layers; $key) as $src
    | if $t != "array" then "ship: \($key) must be a non-empty list of models (got \($t)); set in \($src)"
      elif ($cfg | getpath($key | split(".")) | length) == 0 then "ship: \($key) must be a non-empty list of models; set in \($src)"
      else
        ($cfg | getpath($key | split("."))) as $l
        | range(0; $l | length) as $i | $l[$i]
        | if type != "string" then "ship: \($key) entry \($i + 1) is not a string; set in \($src)"
          else model_err | if . != null then "ship: \(.) (in \($key); set in \($src))" else empty end end
      end;
  [range(0; $ARGS.positional | length) as $i | {file: $ARGS.positional[$i], data: $datas[$i]}] as $layers
  | (reduce $layers[].data as $l ({}; . * $l)) as $m0
  | (if $project != "" and ($m0.units_group | type) == "string"
     then $m0 | .units_group |= gsub("<project>"; $project) else $m0 end) as $cfg
  | ($layers | tojson), ($cfg | tojson),
    (   ($stages | [splits("\\s+")] | map(select(length > 0)) | map("models." + .)[]) , "failover.summarizer"
        | val_models($cfg; $layers; .)),
    ("max_rounds", "budgets.S", "budgets.M", "budgets.L", "budgets.fix_fraction", "budgets.fix_per_finding", "budgets.check"
        | . as $k | ($cfg | ctype($k)) as $t | select($t != "number")
        | "ship: \($k) must be a number (got \($t)); set in \(keysrc($layers; $k))"),
    (if ($cfg | ctype("budgets.fix_per_finding")) == "number" and $cfg.budgets.fix_per_finding < 0
     then "ship: budgets.fix_per_finding must not be negative; set in \(keysrc($layers; "budgets.fix_per_finding"))" else empty end),
    ("limits.patterns", "auth.patterns" | . as $p
        | [try ($cfg | getpath($p / ".") // {} | keys[] | tostring) catch empty][] as $k
        | if ($cfg | ctype($p + "." + $k)) != "string"
          then "ship: \($p).\($k) must be a string (a regex); set in \(keysrc($layers; $p + "." + $k))"
          else $cfg | getpath(($p / ".") + [$k]) as $re
            | if (try ("" | test($re) | true) catch false) then empty
              else "ship: \($p).\($k) is not a valid regex (\($re)); set in \(keysrc($layers; $p + "." + $k))" end
          end)
'

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
      || { _ship_err "cannot read the lead's config $SHIP_CONFIG_FILE"; unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; return 1; }
    SHIP_CONFIG_LAYERS="$(jq -nc --arg f "$SHIP_CONFIG_FILE" '[{file: $f, data: {}}]')"
    export SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
    return 0
  fi
  # A failed load leaves no config behind, even a stale exported one.
  unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
  ship_require_yq || return 1
  command -v jq >/dev/null 2>&1 || { _ship_err "jq is required but was not found on PATH"; return 1; }

  local files=("$SHIP_DEFAULTS_FILE") datas=() root="" f json first kind rc=0
  [[ -f "$SHIP_DEFAULTS_FILE" ]] || { _ship_err "missing defaults file $SHIP_DEFAULTS_FILE"; return 1; }
  [[ -n "${HOME:-}" && -f "$HOME/.config/hyper/ship.yml" ]] && files+=("$HOME/.config/hyper/ship.yml")
  root="$(ship_space_root)" || rc=$?
  # 2 = cannot tell (already reported); 1 = not in a space, so no project layer.
  [[ $rc -eq 2 ]] && return 1
  [[ $rc -eq 0 && -f "$root/.hyper/ship.yml" ]] && files+=("$root/.hyper/ship.yml")

  # One yq per file (so a parse error names its file); the checks that need only
  # the shape of the text (document count, top-level type) run in bash.
  for f in "${files[@]}"; do
    if ! json="$(_ship_layer_text "$f")"; then
      _ship_err "cannot parse $f: $(yq -o=json '.' "$f" 2>&1 >/dev/null)"
      return 1
    fi
    if [[ -z "$json" ]]; then
      json='{}'
    else
      first="${json%%$'\n'*}"
      if [[ "$json" == *$'\n'* ]]; then
        _ship_err "cannot parse $f: multiple YAML documents (a ship config is one document)"
        return 1
      fi
      case "$first" in
        '{'*) ;;
        null) json='{}' ;;
        *)
          case "$first" in
            '['*) kind=array ;; '"'*) kind=string ;; true|false) kind=boolean ;; *) kind=number ;;
          esac
          _ship_err "$f must be a YAML mapping at the top level, not a $kind"
          return 1 ;;
      esac
    fi
    datas+=("$json")
  done

  local out rest project=""
  [[ $rc -eq 0 && -n "$root" ]] && project="${root##*/}"
  out="$(jq -nr --argjson datas "[$(IFS=,; printf '%s' "${datas[*]}")]" \
    --arg project "$project" --arg stages "$SHIP_STAGES" "$_SHIP_LOAD_JQ" --args "${files[@]}" 2>/dev/null)" || {
    _ship_err "cannot merge and validate the config layers (${files[*]})"
    return 1
  }
  rest="${out#*$'\n'}"
  if [[ "$rest" == *$'\n'* ]]; then
    printf '%s\n' "${rest#*$'\n'}" >&2
    return 1
  fi
  SHIP_CONFIG_LAYERS="${out%%$'\n'*}"
  SHIP_CONFIG_JSON="$rest"
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

# ship_default_branch <git-dir> — the remote default branch (origin/HEAD) on stdout. When the clone
# has no origin/HEAD, one `git remote set-head origin --auto` asks the remote; returns 1 if it is
# still unknown.
ship_default_branch() {
  local gdir="${1:?ship_default_branch: git dir required}" ref
  ref="$(git -C "$gdir" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null)" || ref=""
  if [[ -z "$ref" ]]; then
    GIT_TERMINAL_PROMPT=0 git -C "$gdir" remote set-head origin --auto >/dev/null 2>&1 || true
    ref="$(git -C "$gdir" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null)" || ref=""
  fi
  ref="${ref#refs/remotes/origin/}"
  [[ -n "$ref" ]] || return 1
  printf '%s\n' "$ref"
}

# ship_tasks_base <spec-dir> — `base:` from the YAML frontmatter of <spec-dir>/tasks.md on stdout.
# Returns 3 when there is none (no file, no frontmatter, no base, an empty or null value); 4 when
# the frontmatter is never closed.
ship_tasks_base() {
  local f="${1:?ship_tasks_base: spec dir required}/tasks.md" v rc=0
  [[ -f "$f" ]] || return 3
  v="$(awk -v q="'" '
    NR == 1 { if ($0 ~ /^---[ \t]*\r?$/) { fm = 1; next } exit }
    fm && /^---[ \t]*\r?$/ { closed = 1; exit }
    fm && /^base[ \t]*:/ {
      s = $0; sub(/^base[ \t]*:[ \t]*/, "", s); sub(/\r$/, "", s)
      sub(/[ \t]+#.*$/, "", s); sub(/[ \t]+$/, "", s)
      if (s ~ /^".*"$/ || (length(s) > 1 && substr(s, 1, 1) == q && substr(s, length(s), 1) == q)) s = substr(s, 2, length(s) - 2)
      v = s
    }
    END { if (fm && !closed) exit 4; print v }
  ' "$f")" || rc=$?
  [[ $rc -eq 0 ]] || return "$rc"
  case "$v" in ''|null|'~') return 3 ;; esac
  printf '%s\n' "$v"
}

# ship_resolve_base <explicit> <spec-dir> <git-dir> — the base branch of a unit, on stdout. In order:
# the explicit value; `base:` in <spec-dir>/tasks.md; the config key `base` (deprecated); the remote
# default branch. Never a silent "main": returns 1, saying so, when none of them knows.
ship_resolve_base() {
  local explicit="${1:-}" spec="${2:-}" gdir="${3:?ship_resolve_base: git dir required}" v rc
  if [[ -n "$explicit" ]]; then printf '%s\n' "$explicit"; return 0; fi
  if [[ -n "$spec" ]]; then
    rc=0; v="$(ship_tasks_base "$spec")" || rc=$?
    if [[ $rc -eq 4 ]]; then
      _ship_err "warning: $spec/tasks.md has frontmatter that is never closed; its base is ignored"
    elif [[ $rc -eq 0 ]]; then
      if git check-ref-format --branch "$v" >/dev/null 2>&1; then printf '%s\n' "$v"; return 0; fi
      _ship_err "warning: base '$v' in $spec/tasks.md is not a branch name; ignored"
    fi
  fi
  if v="$(ship_cfg_get base 2>/dev/null)" && [[ -n "$v" ]]; then
    _ship_err "warning: the config key 'base' is deprecated (it applies to every feature in the space); put 'base:' in the frontmatter of the feature's tasks.md"
    printf '%s\n' "$v"; return 0
  fi
  if v="$(ship_default_branch "$gdir")"; then printf '%s\n' "$v"; return 0; fi
  _ship_err "cannot tell the base branch: no --base, no 'base:' in tasks.md, and origin/HEAD is unknown in $gdir. Pass --base <branch>"
  return 1
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

# --- locks ---------------------------------------------------------------------------------------
# ship_lock <path> <timeout_s> [stale_s] — take the lock file <path>, waiting up to <timeout_s> seconds
# (0 = one try). Returns 1 when it could not. The file is created with noclobber (O_EXCL), which is atomic
# on every platform; a mkdir lock is not (uutils mkdir, the ubuntu CI image's, lets several callers win),
# and the flock(1) command is missing on macOS. The file holds "pid@host" (the pid of the calling shell or
# subshell). A lock is stale when its owner is on this host and dead, or (owner elsewhere or unknown) when it
# is older than <stale_s> seconds (default 120) and stat could read its age; a live owner on this host is
# never taken from. A lock is never moved or put back.
# Taking over a stale lock is a critical section, and it is a kernel lock when perl is there: one perl
# process opens "<path>.break", takes flock LOCK_EX, judges the lock's owner again by the rules above,
# unlinks the lock only if it still holds the same stale owner, and exits. Exiting (or
# dying) releases the flock, so ".break" has no owner and no staleness; nobody ever deletes it and it stays
# behind, empty, next to the lock. Locks must be on a local filesystem (flock and O_EXCL are not reliable on
# NFS and the like). Without perl (or with SHIP_LOCK_NO_PERL=1, which is for tests only: waiters that mix the
# two takeover paths on one lock do not exclude each other) the section is a second
# noclobber file "<path>.break" holding the taker's pid@host: judge again under it, remove the lock only if
# the owner is unchanged, drop it. That fallback treats a ".break" as stale on the same rules after 5 seconds
# and removes it only after re-reading it. It is not airtight: removing a stale ".break" is a cat/rm gap, and
# one dead ".break" plus bad timing can let two waiters through the takeover.
# A directory left by an old mkdir lock is removed with rmdir. Sets SHIP_LOCK_OWNER to what the lock file said
# when it gave up. SHIP_LOCK_TEST_PAUSE=<ms> makes the takeover pause a random time at its race windows (tests
# only). Safe under `set -e`.
SHIP_LOCK_OWNER=""
SHIP_LOCK_HOST=""
# _ship_set_me — set SHIP_LOCK_ME to "pid@host" for this shell or subshell. $$ is the parent's in a subshell,
# bash 3.2 has no BASHPID, and a command substitution is a subshell of its own, so this sets a variable
# instead of printing
SHIP_LOCK_ME=""
_ship_set_me() {
  local t="" p=""
  _ship_lock_init
  if [[ -n "${BASHPID:-}" ]]; then p="$BASHPID"
  else
    t="$(mktemp "${TMPDIR:-/tmp}/ship-pid.XXXXXX")" || t=""
    if [[ -n "$t" ]]; then sh -c 'echo $PPID' >"$t"; read -r p <"$t" || p=""; rm -f "$t"; fi
    [[ -n "$p" ]] || p="$$"
  fi
  SHIP_LOCK_ME="$p@$SHIP_LOCK_HOST"
}
_ship_lock_init() { if [[ -z "$SHIP_LOCK_HOST" ]]; then SHIP_LOCK_HOST="$(hostname 2>/dev/null || echo unknown)"; fi; }
_ship_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || true; }
_ship_pause() {
  if [[ "${SHIP_LOCK_TEST_PAUSE:-0}" =~ ^[1-9][0-9]*$ ]]; then
    sleep "$(printf '0.%03d' $(( (RANDOM + $$ + SECONDS) % SHIP_LOCK_TEST_PAUSE % 1000 )))"
  fi
  return 0
}
# _ship_judge <file> <stale_s> — returns 0 when <file> exists and its owner is dead or it is too old; sets SHIP_LOCK_OWNER
_ship_judge() {
  local f="$1" stale_s="$2" owner="" opid ohost m age
  SHIP_LOCK_OWNER=""
  [[ -f "$f" ]] || return 1
  owner="$(cat "$f" 2>/dev/null || true)"
  SHIP_LOCK_OWNER="$owner"
  if [[ "$owner" == *@* ]]; then
    opid="${owner%%@*}" ohost="${owner#*@}"
    if [[ "$ohost" == "$SHIP_LOCK_HOST" && "$opid" =~ ^[0-9]+$ ]]; then
      # on this host the pid decides, however old the lock is
      # kill -0 fails with EPERM for a live process of another user: that is alive too (as in the perl path)
      if kill -0 "$opid" 2>/dev/null || ps -p "$opid" >/dev/null 2>&1; then return 1; fi
      return 0
    fi
  fi
  m="$(_ship_mtime "$f")"
  if [[ "$m" =~ ^[0-9]+$ ]]; then
    age=$(( $(date +%s) - m ))
    if [[ $age -gt $stale_s ]]; then return 0; fi
  fi
  return 1
}
# _ship_flock_break <lock> <owner> <stale_s> — the perl takeover (see ship_lock): under flock on <lock>.break,
# unlink <lock> if it still holds <owner> and that owner is dead or too old.
# exit 0: done or nothing to do; 2: could not get the flock in 20 s; 3: could not open .break
_ship_flock_break() {
  perl -e '
    use strict; use Fcntl qw(:flock O_RDWR O_CREAT);
    my ($l, $owner, $stale, $host) = @ARGV;
    my $pause = $ENV{SHIP_LOCK_TEST_PAUSE} || 0;
    sub nap { select(undef, undef, undef, int(rand($pause)) / 1000) if $pause =~ /^[1-9][0-9]*$/; }
    sysopen(my $bk, "$l.break", O_RDWR | O_CREAT, 0644) or exit 3;
    $SIG{ALRM} = sub { exit 2 }; alarm 20;
    flock($bk, LOCK_EX) or exit 2;
    alarm 0;
    nap();
    open(my $fh, "<", $l) or exit 0;
    my @st = stat($fh) or exit 0;
    my $cur = <$fh>; $cur = "" unless defined $cur; chomp $cur;
    exit 0 if $cur ne $owner;
    my $dead = 0;
    if ($cur =~ /^([0-9]+)@(.*)$/ && $2 eq $host) {
      $dead = (kill(0, $1) || $!{EPERM}) ? 0 : 1;
    } else {
      $dead = (time - $st[9] > $stale) ? 1 : 0;
    }
    exit 0 unless $dead;
    nap();
    unlink $l;
    exit 0;
  ' "$1" "$2" "$3" "$SHIP_LOCK_HOST"
}
ship_lock() {
  local l="$1" wait_s="${2:-30}" stale_s="${3:-120}" start="$SECONDS" me owner bowner last=""
  _ship_set_me
  me="$SHIP_LOCK_ME"
  mkdir -p "$(dirname "$l")" 2>/dev/null || true
  while true; do
    if ( set -C; printf '%s\n' "$me" >"$l" ) 2>/dev/null; then return 0; fi
    if [[ -d "$l" ]]; then
      rmdir "$l" 2>/dev/null || true
    elif _ship_judge "$l" "$stale_s"; then
      owner="$SHIP_LOCK_OWNER" last="$owner"
      _ship_pause
      if [[ "${SHIP_LOCK_NO_PERL:-}" != 1 ]] && command -v perl >/dev/null 2>&1; then
        _ship_flock_break "$l" "$owner" "$stale_s" || true
        if [[ ! -e "$l" ]]; then continue; fi
      elif ( set -C; printf '%s\n' "$me" >"$l.break" ) 2>/dev/null; then
        if _ship_judge "$l" "$stale_s" && [[ "$SHIP_LOCK_OWNER" == "$owner" ]]; then
          _ship_pause
          rm -f "$l"
        fi
        if [[ -f "$l.break" && "$(cat "$l.break" 2>/dev/null || true)" == "$me" ]]; then rm -f "$l.break"; fi
        continue
      elif _ship_judge "$l.break" 5; then
        # remove the stale .break only if it still holds the owner judged stale: another waiter may have
        # removed it and a third made a fresh one in between
        bowner="$SHIP_LOCK_OWNER"
        _ship_pause
        if [[ -f "$l.break" && "$(cat "$l.break" 2>/dev/null || true)" == "$bowner" ]]; then rm -f "$l.break"; fi
        continue
      fi
    else
      last="$SHIP_LOCK_OWNER"
    fi
    if [[ $((SECONDS - start)) -ge $wait_s ]]; then SHIP_LOCK_OWNER="$last"; return 1; fi
    sleep 0.05
  done
}
# ship_unlock <path> — release the lock if it is still ours (after a takeover it belongs to someone else).
ship_unlock() {
  local o=""
  _ship_set_me
  if [[ -f "$1" ]]; then o="$(cat "$1" 2>/dev/null || true)"; fi
  if [[ "$o" == "$SHIP_LOCK_ME" ]]; then rm -f "$1"; fi
  return 0
}

# ship_limit_record <account|model> <key> <until epoch> — add an entry to limited.json (the file pick_model
# reads), atomically and under a lock, keeping the entries other units wrote.
ship_limit_record() {
  local f cur tmp rc=0 c
  f="$(ship_quota_dir)/limited.json"
  mkdir -p "$(dirname "$f")" || return 1
  c=models; [[ "$1" != account ]] || c=accounts
  ship_lock "$f.lock" 120 60 || { _ship_err "limited.json is locked (by ${SHIP_LOCK_OWNER:-?})"; return 1; }
  cur='{}'
  if [[ -s "$f" ]]; then cur="$(jq -c 'if type == "object" then . else {} end' "$f" 2>/dev/null)" || cur='{}'; [[ -n "$cur" ]] || cur='{}'; fi
  tmp="$f.tmp.$$"
  jq -c --arg c "$c" --arg key "$2" --argjson u "$3" '.[$c] = ((.[$c] // {}) + {($key): {until: $u}})' <<<"$cur" >"$tmp" \
    && mv -f "$tmp" "$f" || rc=1
  rm -f "$tmp"
  ship_unlock "$f.lock"
  return $rc
}

# ship_limit_clear <name> — remove an account or a model named <name> from limited.json (the lead's way to say
# the quota is back). 0 also when there was nothing to remove.
ship_limit_clear() {
  local f cur tmp rc=0
  f="$(ship_quota_dir)/limited.json"
  [[ -s "$f" ]] || return 0
  ship_lock "$f.lock" 120 60 || { _ship_err "limited.json is locked (by ${SHIP_LOCK_OWNER:-?})"; return 1; }
  cur="$(jq -c 'if type == "object" then . else {} end' "$f" 2>/dev/null)" || cur='{}'
  tmp="$f.tmp.$$"
  jq -c --arg n "$1" 'del(.accounts[$n]?) | del(.models[$n]?)' <<<"$cur" >"$tmp" && mv -f "$tmp" "$f" || rc=1
  rm -f "$tmp"
  ship_unlock "$f.lock"
  return $rc
}
