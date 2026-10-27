#!/usr/bin/env bash
# Row T (ship-config validation) — the model-name and regex checks that
# ship_config_load runs in its single jq pass, one load per case, in-process.
# test-t-ship-config.sh covers layering and the other keys; ship_model_parse's
# own table lives there too. Here: the loader's copy of the model grammar must
# agree with ship_model_parse, and the pattern checks must reject what jq rejects.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SPACE="$FIX/space"
make_bare_space "$SPACE"
mkdir -p "$SPACE/.hyper"
export SHIP_SPACE_ROOT="$SPACE"
# shellcheck source=../scripts/ship/lib.sh
source "$SCRIPTS_DIR/ship/lib.sh"

# try <yaml> — load with the yaml as the project layer; sets rc and err.
try() {
  printf '%s\n' "$1" > "$SPACE/.hyper/ship.yml"
  unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
  rc=0; err="$(ship_config_load 2>&1)" || rc=$?
}

try 'gate: "true"'
assert_eq "a valid config loads" "0" "$rc"

# Every model the loader rejects is one ship_model_parse rejects, with its text.
for m in 'sonnet:high' 'zai/glm:' '/glm' 'zai/' 'zai/:high' 'a b'; do
  try "models: {dev: [\"$m\"]}"
  want="$(ship_model_parse "$m" 2>&1 >/dev/null)"
  assert_eq "model '$m' rejected" "1" "$rc"
  assert_contains "model '$m': same message as ship_model_parse" "$err" "${want#ship: } (in models.dev; set in $SPACE/.hyper/ship.yml)"
done
# Whitespace of every kind (the YAML text escapes it; ship_model_parse gets the real character).
TAB=$'\t' NL=$'\n'
for pair in 'a\tb|a'"$TAB"'b' 'a\nb|a'"$NL"'b' 'a\n|a'"$NL"; do
  y="${pair%%|*}" m="${pair#*|}"
  try "models: {dev: [\"$y\"]}"
  want="$(ship_model_parse "$m" 2>&1 >/dev/null)"
  assert_eq "model with whitespace '$y' rejected" "1" "$rc"
  assert_contains "model with whitespace '$y': same message as ship_model_parse" "$err" "${want#ship: } (in models.dev; set in $SPACE/.hyper/ship.yml)"
done
# Non-ASCII whitespace (NBSP) is always rejected, whatever the locale.
try 'models: {dev: ["a\u00a0b"]}'
assert_eq "model with NBSP rejected" "1" "$rc"
assert_contains "model with NBSP: whitespace message" "$err" "empty or contains whitespace (in models.dev; set in $SPACE/.hyper/ship.yml)"
for m in 'sonnet' 'zai/glm-5.3' 'zai/glm-5.3:high' 'a/b/c:d:e'; do
  try "models: {dev: [\"$m\"]}"
  assert_eq "model '$m' accepted" "0" "$rc"
done

# limits.patterns: the value must be a string and a regex jq can compile.
try 'limits: {patterns: {claude: "(unclosed"}}'
assert_eq "invalid regex rejected" "1" "$rc"
assert_contains "invalid regex names key, value and file" "$err" "limits.patterns.claude is not a valid regex ((unclosed); set in $SPACE/.hyper/ship.yml"
try 'limits: {patterns: {claude: 5}}'
assert_contains "non-string pattern rejected" "$err" "limits.patterns.claude must be a string (a regex)"
try 'limits: {patterns: {claude: "ok.*"}}'
assert_eq "valid pattern accepted" "0" "$rc"

# A layer that sets a parent key to a non-mapping owns the child's error.
USER_CFG="$HOME/.config/hyper/ship.yml"
mkdir -p "${USER_CFG%/*}"
printf 'budgets: 5\n' > "$USER_CFG"
try 'gate: "true"'
assert_eq "user layer 'budgets: 5' fails the load" "1" "$rc"
assert_contains "blames the user layer, not defaults.yml" "$err" "budgets.S must be a number (got null); set in $USER_CFG"
rm -f "$USER_CFG"

# A failed load leaves no config behind, even an exported stale one.
export SHIP_CONFIG_JSON='{"stale":1}' SHIP_CONFIG_LAYERS=''
printf 'models: {dev: []}\n' > "$SPACE/.hyper/ship.yml"
ship_config_load >/dev/null 2>&1; rc=$?
assert_eq "invalid config: load fails" "1" "$rc"
assert_eq "failed load unsets SHIP_CONFIG_JSON" unset "${SHIP_CONFIG_JSON-unset}"
assert_eq "failed load unsets SHIP_CONFIG_LAYERS" unset "${SHIP_CONFIG_LAYERS-unset}"

# jq itself failing is reported as a ship: message naming the files, not raw jq text.
mkdir -p "$FIX/fakebin"
printf '#!/bin/sh\necho "jq: boom" >&2\nexit 3\n' > "$FIX/fakebin/jq"
chmod +x "$FIX/fakebin/jq"
printf 'gate: "true"\n' > "$SPACE/.hyper/ship.yml"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS
err="$(PATH="$FIX/fakebin:$PATH" ship_config_load 2>&1)"; rc=$?
assert_eq "jq failure: load fails" "1" "$rc"
assert_contains "jq failure: ship: message" "$err" "ship: cannot merge and validate the config layers ("
assert_contains "jq failure: names the files" "$err" "$SPACE/.hyper/ship.yml)"
assert_not_contains "jq failure: no raw jq text" "$err" "boom"

finish
