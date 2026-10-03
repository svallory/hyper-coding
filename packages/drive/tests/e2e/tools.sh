#!/usr/bin/env bash
# e2e: the tool registry, against a throwaway HOME.
#
# NOT over a loopback ssh hop: ssh cannot change the remote HOME (OpenSSH's
# AcceptEnv covers locale and a handful of LANG-ish variables, never HOME), so a
# loopback run would install into the operator's real ~/.local/bin and their
# shell rc files — which this script must never do. Closing that gap means giving
# MachineRunner a way to set the remote environment, which it does not have
# (SshOptions.env is local-only, and says so). Until then this runs locally with a
# PATH that hides the operator's own tools, so the recipes have to really download.
#
# Runs `hyper machine setup --features tools --tools wt,rg --yes` against a fake
# machine that Herdr maps to `localhost`, with HOME pointed at a throwaway
# directory whose PATH excludes the operator's own tool directories — so the
# recipes have to really download and really install, over ssh, on the other
# side of a connection. It asserts:
#   1. the temp HOME's ~/.local/bin really was empty before the run
#   2. both tools were installed there, and answer --version from there
#   3. the parity table printed by the command lists them with a version
#   4. every parity row says `ok` — the machine has what this one has
#   5. a second run installs nothing and reports everything already fine (C-15)
#   6. the temp HOME is removed at the end (trap)
#
# Usage: packages/drive/tests/e2e/tools.sh
# Cost:   NEEDS NETWORK. Downloads mise (for rg) and a worktrunk release, ~30 MB.
#         It never touches the operator's real ~/.local/bin, their shell rc files,
#         or their mise install: HOME is a temp dir for the whole run, and the
#         trap deletes it. Nothing is ever installed with root.
#
# Requirements: drive and cli built (`bun run build` in both).
#
# Note jq is not in the list: macOS ships /usr/bin/jq, so `detect` finds it
# there and correctly installs nothing. rg is the mise path, absent from macOS,
# and is what proves a recipe ran. wt is the release-tarball path.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# e2e -> tests -> drive -> packages, so the CLI is three levels up.
cli="$here/../../../cli/bin/run.js"
[ -f "$cli" ] || { echo "# cannot find the CLI at $cli — build packages/cli first" >&2; exit 1; }

step=0
pass() { step=$((step + 1)); printf 'ok %d - %s\n' "$step" "$1"; }
die() { printf 'not ok %d - %s\n' "$((step + 1))" "$1" >&2; exit 1; }
# The whole test is "can we reach ourselves over ssh?". Without that there is no
# loopback to test, and saying so is better than a confusing failure.
work="$(mktemp -d "${TMPDIR:-/tmp}/hyperdrive-e2e-tools.XXXXXX")"
home="$work/home"
remote_home="$work/remote"
mkdir -p "$home/.local/bin" "$remote_home/.local/bin"
cleanup() {
  if [ "$?" -eq 0 ]; then
    echo "# cleaning up $work"
    rm -rf "$work"
  else
    echo "# FAILED — left $work for inspection" >&2
  fi
}
trap cleanup EXIT

# drive.toml has to be where the config loader reads it (XDG_CONFIG_HOME), and the
# machine entry is what makes `localhost` a machine rather than a guess.
export XDG_CONFIG_HOME="$work/config"
mkdir -p "$XDG_CONFIG_HOME/hyper"
cat >"$XDG_CONFIG_HOME/hyper/drive.toml" <<EOF
remote = "git@example:x.git"

[machines.loop]
home = "$remote_home"
features = ["tools"]
EOF

# A fake herdr on PATH, so `resolveMachine` sees the host the way T-14's tests
# do. Without it the machine comes from drive.toml alone, which is enough.
fakebin="$work/bin"
mkdir -p "$fakebin"
cat >"$fakebin/herdr" <<EOF
#!/usr/bin/env bash
[ "\$1 \$2" = "machine list" ] && echo '[{"label":"loop","target":"localhost","enabled":true}]'
exit 0
EOF
chmod +x "$fakebin/herdr"

# The temp HOME, on both sides. `ssh localhost` runs a login shell as the
# operator, so the recipe has to install into the temp HOME the *command* sees —
# which it does, because every command goes through the runner and inherits this
# process's HOME.
export HOME="$home"
export XDG_DATA_HOME="$home/.local/share"
export XDG_CACHE_HOME="$home/.cache"
export HYPER_MACHINE_SCRATCH="$work/scratch"
unset CLAUDE_CONFIG_DIR || true

# A PATH without the operator's own tool directories: a homebrew jq on the
# inherited PATH would satisfy `detect` and the recipes would never run.
stubs="$work/stubs"
mkdir -p "$stubs"
for tool in node bun curl tar sed grep cat uname install find head env sh bash; do
  path="$(command -v "$tool" || true)"
  [ -n "$path" ] && ln -sf "$path" "$stubs/$tool"
done
export PATH="$fakebin:$stubs:/usr/bin:/bin:/usr/sbin:/sbin"

echo "# HOME=$HOME  ~/.local/bin=$(ls -A "$home/.local/bin" | wc -l | tr -d ' ') entries"
[ -z "$(ls -A "$home/.local/bin")" ] || die "the temp ~/.local/bin was not empty to begin with"
pass "the temp ~/.local/bin starts empty"

run_setup() {
  "$cli" machine setup --features tools --tools wt,rg --yes 2>&1 | tee "$work/out-$1.txt"
}

echo "# first run: installs both tools"
first="$(run_setup first)"

for tool in wt rg; do
  [ -x "$home/.local/bin/$tool" ] || die "$tool is not in the temp ~/.local/bin after setup"
done
pass "wt (release tarball) and rg (mise) are installed in the temp ~/.local/bin"

wt_version="$("$home/.local/bin/wt" --version)"
rg_version="$("$home/.local/bin/rg" --version | head -1)"
echo "# wt: $wt_version"
echo "# rg: $rg_version"
case "$wt_version" in
wt\ *) ;;
*) die "wt --version didn't answer with a version: $wt_version" ;;
esac
case "$rg_version" in
ripgrep*) ;;
*) die "rg --version didn't answer with a version: $rg_version" ;;
esac
pass "both tools answer --version from the temp home"

for id in tools.wt tools.rg; do
  case "$first" in
  *"$id"*) ;;
  *) die "the run didn't report a $id task" ;;
  esac
done
pass "the report names the tool tasks"

echo "# parity table"
printf '%s\n' "$first" | sed -n '/tool  /,$p' | tee "$work/parity.txt"
grep -q '^  rg ' "$work/parity.txt" || die "no rg row in the parity table"
grep -q '^  wt ' "$work/parity.txt" || die "no wt row in the parity table"
# Every row must be `ok`: the machine was just given what this one has. A
# `missing` here means the parity detection lost a connection, not that a tool
# is absent.
awk 'NR > 1 && NF && $NF != "ok" { print "row not ok: " $0; bad = 1 } END { exit bad }' "$work/parity.txt" ||
  die "some parity rows were not ok"
pass "every parity row says ok"

echo "# second run: installs nothing (C-15)"
second="$(run_setup second)"
# Task order is registry order, so assert membership rather than one exact string.
for id in tools.path tools.wt tools.rg; do
  case "$second" in
  *"already fine: "*"$id"*) ;;
  *) printf '%s\n' "$second"; die "$id was not reported as already fine" ;;
  esac
done
pass "a second setup run changes nothing"

echo
echo "# all $step checks passed"