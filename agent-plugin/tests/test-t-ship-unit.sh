#!/usr/bin/env bash
# Row T (ship-unit, ship-land --host) — starting, resuming, waiting for and listing
# units, locally and on a host. The multiplexer is mux/fake; ssh, rsync, wt and the
# driver are stubs. The "host" is this machine with a filesystem of its own: its own
# space ($HOSTSPACE, with its own bare repo and worktrees), its own HOME, its own fake
# multiplexer, and a command environment that does not inherit ours (env -i with a
# whitelist). The stub ssh rewrites our space path to the host's, and the stub rsync
# maps "host:path" the same way, so nothing reaches the host except what ship-unit sends.
# No real multiplexer, ssh, rsync or network is touched.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
UNIT="$SHIP_DIR/ship-unit"
LAND="$SHIP_DIR/ship-land"

SPACE="$FIX/proj"
G="$SPACE/.git"
HOSTSPACE="$FIX/hostproj"
HG="$HOSTSPACE/.git"
HOSTHOME="$FIX/hosthome"
REMOTE="$FIX/remote.git"
export FIX SPACE HOSTSPACE HOSTHOME
export SHIP_SPACE_ROOT="$SPACE"
export SHIP_MUX_FAKE_DIR="$FIX/fake" SHIP_MUX_FAKE_LOG="$FIX/fake.log" SHIP_MUX_TEST=1
export SHIP_UNIT_POLL_S=0.1 SHIP_UNIT_BACKOFF_MAX_S=0.5 SHIP_UNIT_LOCK_WAIT_S=120
export SHIP_LOOP_BIN="$FIX/bin/loop-stub"
export WT_LOG="$FIX/wt.log" SSH_LOG="$FIX/ssh.log" RSYNC_LOG="$FIX/rsync.log"
export STUB_G="$G" STUB_SPACE="$SPACE" LIBSH="$SHIP_DIR/lib.sh"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS SHIP_CONFIG_FILE

# --- fixture: two spaces (ours and the host's) over one bare origin ----------------------
git init -q --bare "$REMOTE"
git clone -q "$REMOTE" "$FIX/seed" 2>/dev/null
echo base > "$FIX/seed/base.txt"
git -C "$FIX/seed" add base.txt
git -C "$FIX/seed" commit -q -m "chore: base"
git -C "$FIX/seed" branch -M main
git -C "$FIX/seed" push -q origin main
git -C "$REMOTE" symbolic-ref HEAD refs/heads/main
mk_space() { # dir
  git clone -q --bare "$REMOTE" "$1/.git"
  git -C "$1/.git" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
  git -C "$1/.git" fetch -q origin
  mkdir -p "$1/worktrees" "$1/.hyper" "$1/notes/loops" "$1/notes/specs/feat"
  git -C "$1/.git" worktree add -q "$1/worktrees/main" main
}
mkdir -p "$SPACE" "$HOSTSPACE" "$HOSTHOME"
mk_space "$SPACE"
mk_space "$HOSTSPACE"
echo "# rulings" > "$SPACE/notes/decisions.md"
echo "# spec" > "$SPACE/notes/specs/feat/design.md"
# Only we have a ship.yml: the host must run under the config we send, not its own.
printf 'mux: fake\ngate: "true"\nrulings: notes/decisions.md\nhosts:\n  box:\n    ssh: fakehost\n    slots: 1\n  box2:\n    ssh: fakehost2\n    slots: 1\n  nossh:\n    slots: 1\n' > "$SPACE/.hyper/ship.yml"
BRIEF="$SPACE/notes/brief-a.md"
echo "# brief" > "$BRIEF"
# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
# shellcheck source=../scripts/ship/lib-host.sh
source "$SHIP_DIR/lib-host.sh"
ship_config_load      # one config load per run, as the lead's scripts share it

# --- stubs ---------------------------------------------------------------------------------
mkdir -p "$FIX/bin"
cat > "$FIX/bin/wt" <<'STUB'
#!/usr/bin/env bash
echo "$PWD :: $*" >> "$WT_LOG"
[[ "$1" == switch ]] || exit 1
br="${*: -1}"
start="" prev=""
for a in "$@"; do [[ "$prev" == -b ]] && start="$a"; prev="$a"; done
if [[ -n "$start" ]]; then
  git -C "$STUB_G" worktree add -q -b "$br" "$STUB_SPACE/worktrees/$br" "$start"
else
  git -C "$STUB_G" worktree add -q "$STUB_SPACE/worktrees/$br" "$br"
fi
# Like the real wt failing late: the branch and worktree exist, and the exit is non-zero.
if [[ -e "$FIX/wt.fail" ]]; then
  echo "✗ git branch --unset-upstream -- $br failed (exit 128) fatal: branch '$br' has no upstream information" >&2
  exit 128
fi
STUB
# The host's environment: nothing of ours but what is listed.
cat > "$FIX/bin/hostenv" <<'STUB'
#!/usr/bin/env bash
exec env -i $(cat "$FIX/host.env") "$@"
STUB
cat > "$FIX/bin/ssh" <<'STUB'
#!/usr/bin/env bash
echo "ssh $*" >> "$SSH_LOG"
while [[ "$1" == -o ]]; do shift 2; done
shift   # the destination
if [[ -e "$FIX/ssh.down" ]]; then exit 255; fi
if [[ -e "$FIX/ssh.drop" && "$*" == *_probe* ]]; then rm -f "$FIX/ssh.drop"; exit 255; fi
if [[ -e "$FIX/ssh.spy" && "$*" == *ship-land* ]]; then
  [[ -e "$SPACE/.hyper/ship-land.lock" ]] && echo held >> "$FIX/spy.out"
fi
cmd="$*"
cmd="${cmd//$SPACE/$HOSTSPACE}"
cd "$HOSTHOME" || exit 255
[[ ! -e "$FIX/ssh.noise" ]] || echo "Last login: Sat Oct 25 on ttys001"
"$FIX/bin/hostenv" bash -c "${cmd/#bash -lc /bash -c }"
rc=$?
[[ ! -e "$FIX/ssh.noise" ]] || echo "ship-unit-probe: bogus dead"
exit $rc
STUB
cat > "$FIX/bin/rsync" <<'STUB'
#!/usr/bin/env bash
echo "rsync $*" >> "$RSYNC_LOG"
if [[ -e "$FIX/ssh.down" ]]; then exit 255; fi
del=0 args=()
for a in "$@"; do case "$a" in --delete) del=1 ;; -*) ;; *) args+=("$a") ;; esac; done
map() { # a "host:path" is on the host; relative host paths are under its HOME
  local x="$1"
  case "$x" in
    /*) ;;
    *:*) x="${x#*:}"; case "$x" in /*) x="${x/#$SPACE/$HOSTSPACE}" ;; *) x="$HOSTHOME/$x" ;; esac ;;
  esac
  printf '%s' "$x"
}
src="$(map "${args[0]}")"; dst="$(map "${args[1]}")"
# Real rsync tolerates two clients writing the same tree; this stub's cp does not.
until mkdir "$FIX/rsync.lock" 2>/dev/null; do
  lp="$(cat "$FIX/rsync.lock/pid" 2>/dev/null)"
  if [[ -n "$lp" ]] && ! kill -0 "$lp" 2>/dev/null; then rm -f "$FIX/rsync.lock/pid"; rmdir "$FIX/rsync.lock" 2>/dev/null; fi
  sleep 0.02
done
echo $$ > "$FIX/rsync.lock/pid"
trap 'rm -f "$FIX/rsync.lock/pid"; rmdir "$FIX/rsync.lock"' EXIT
if [[ -d "$src" ]]; then
  mkdir -p "$dst"
  [[ "$(cd "$src" && pwd -P)" != "$(cd "$dst" && pwd -P)" ]] || exit 0
  cp -R "${src%/}/." "$dst/"
  if [[ $del -eq 1 ]]; then
    (cd "$dst" && find . -type f) | while IFS= read -r f; do [[ -e "$src/$f" ]] || rm -f "$dst/$f"; done
  fi
else
  [[ "$src" -ef "$dst" ]] && exit 0
  case "$dst" in */) mkdir -p "$dst" ;; esac
  cp "$src" "$dst"
fi
STUB
# The driver: behaviour per ref from $FIX/mode.<ref>; every start's arguments, models and
# environment are kept. "hold" runs until $FIX/release.<ref> exists.
cat > "$FIX/bin/loop-stub" <<'STUB'
#!/usr/bin/env bash
ref=""
for ((i = 1; i <= $#; i++)); do [[ "${!i}" == --ref ]] && { j=$((i + 1)); ref="${!j}"; }; done
n=$(ls "$FIX"/loopargs."$ref".* 2>/dev/null | wc -l | tr -d ' ')
n=$((n + 1))
printf '%s\n' "$@" > "$FIX/loopargs.$ref.$n"
D="$SHIP_SPACE_ROOT/notes/loops/$ref"
cat "$D/models.override" > "$FIX/loopmodels.$ref.$n" 2>/dev/null
printf '%s' "$PATH" > "$FIX/looppath.$ref.$n"
slots="$(source "$LIBSH"; ship_config_load >/dev/null 2>&1; ship_cfg_get hosts.box.slots 2>/dev/null)"
echo "host=${SHIP_HOST:-} cfgfile=${SHIP_CONFIG_FILE:-} slots=$slots" > "$FIX/loopenv.$ref.$n"
result() { jq -nc --arg r "$ref" --arg s "$1" --arg h "${SHIP_HOST:-local}" '{ref: $r, pr: 7, stage: "finalize", status: $s, failovers: 0, host: $h}' > "$D/result.json"; cat "$D/result.json"; }
ready() { result READY; exit 0; }
mode="$(cat "$FIX/mode.$ref")"
case "$mode" in
  ready) ready ;;
  error) result ERROR; exit 1 ;;
  hold) for _ in $(seq 1 3000); do [[ -e "$FIX/release.$ref" ]] && ready; sleep 0.1; done; exit 1 ;;
  park|park3|parklimit|parkdialog)
    pn=1; st=QUESTION
    [[ "$mode" == park3 ]] && pn=3
    [[ "$mode" == parklimit ]] && st=LIMIT
    [[ "$mode" == parkdialog ]] && st=DIALOG
    if [[ -s "$D/answer-$pn.md" ]]; then ready; fi
    jq -nc --argjson n "$pn" --arg s "$st" '{status: $s, stage: "develop", agent: "a", question: "q", since: "t", n: $n, file: ""}' > "$D/park.json"
    result PARKED; exit 2 ;;
  over)
    if [[ -s "$D/extend" ]]; then mv "$D/extend" "$D/extend.applied"; touch "$D/budget-r1.json.handled"; ready; fi
    echo '{"verdict":"OVER-BUDGET","stage":"develop","agent":"a","class":"S","budget_min":15,"elapsed_min":16,"file":"develop.json"}' > "$D/budget-r1.json"
    result OVER-BUDGET; exit 2 ;;
esac
STUB
# A stand-in driver process: its command line names ship-loop, as a real driver's does.
cat > "$FIX/bin/ship-loop-sleeper" <<'STUB'
#!/usr/bin/env bash
while :; do sleep 1; done
STUB
chmod +x "$FIX/bin/"*
export PATH="$FIX/bin:$PATH"
cat > "$FIX/host.env" <<ENV
HOME=$HOSTHOME
PATH=$PATH
FIX=$FIX
TMPDIR=${TMPDIR:-/tmp}
SHIP_MUX_TEST=1
SHIP_MUX_FAKE_DIR=$FIX/hostfake
SHIP_MUX_FAKE_LOG=$FIX/hostfake.log
SHIP_LOOP_BIN=$FIX/bin/loop-stub
SHIP_UNIT_POLL_S=0.1
SHIP_UNIT_LOCK_WAIT_S=120
WT_LOG=$FIX/wt.log
STUB_G=$HG
STUB_SPACE=$HOSTSPACE
LIBSH=$LIBSH
ENV

# Two panes stand in for the multiplexers: every `run` a fake records is executed once,
# ours with our environment, the host's with the host's.
pane_runner() { # fake log, env prefix command...
  local log="$1"; shift
  local n=0 total line cmd
  while :; do
    total=0
    [[ -f "$log" ]] && total="$(wc -l < "$log" | tr -d ' ')"
    while [[ $n -lt $total ]]; do
      n=$((n + 1))
      line="$(sed -n "${n}p" "$log")"
      if [[ "$(jq -r .verb <<<"$line")" == run ]]; then
        cmd="$(jq -r '.args[-1]' <<<"$line")"
        "$@" bash -c "$cmd" >> "$FIX/pane.out" 2>&1 &
      fi
    done
    sleep 0.05
  done
}
pane_runner "$SHIP_MUX_FAKE_LOG" env &
PANE1=$!
pane_runner "$FIX/hostfake.log" "$FIX/bin/hostenv" &
PANE2=$!
SLEEPERS=""
cleanup() { kill "$PANE1" "$PANE2" $SLEEPERS 2>/dev/null; }
trap cleanup EXIT

unit() { SHIP_UNIT_INTERNAL='' bash "$UNIT" "$@" 2>"$FIX/unit.err" >"$FIX/unit.out"; echo $?; }
err() { cat "$FIX/unit.err"; }
out() { cat "$FIX/unit.out"; }
mode() { printf '%s' "$2" > "$FIX/mode.$1"; }
release() { : > "$FIX/release.$1"; }
loops() { echo "$SPACE/notes/loops/$1"; }
hloops() { echo "$HOSTSPACE/notes/loops/$1"; }
mux_count() { jq -c --arg v "$1" 'select(.verb == $v)' "${2:-$SHIP_MUX_FAKE_LOG}" 2>/dev/null | wc -l | tr -d ' '; }
wait_for() { # seconds command...
  local t="$1" i=0; shift
  while ! "$@" 2>/dev/null; do sleep 0.1; i=$((i + 1)); [[ $i -lt $((t * 10)) ]] || return 1; done
}
exists() { [[ -e "$1" ]]; }
# refused <tag> <tag> — one of the two background runs has ended with 3.
refused() { [[ "$(cat "$FIX/bg.$1.rc" 2>/dev/null)" == 3 || "$(cat "$FIX/bg.$2.rc" 2>/dev/null)" == 3 ]]; }
diag() { { echo "diag: locks and processes"; ls -d "$HOSTSPACE"/.hyper/* "$FIX"/rsync.lock* "$FIX"/bg.*.rc 2>&1; ps -ax -o pid,command | grep -E 'ship-(unit|loop)|rsync|loop-stub' | grep -v grep | cut -c1-140; } | sed 's/^/# /' >&2; }
# pair_ok <a> <b> — one ended with 3, the other has not ended; diag on a miss.
pair_ok() { { [[ "$1/$2" == "3/" ]] || [[ "$1/$2" == "/3" ]]; } && echo yes || { diag; echo no; }; }
gone() { [[ ! -e "$1" ]]; }
# bg <tag> args... — a ship-unit in the background; bgrc <tag> waits for it and prints its code.
bg() { local tag="$1"; shift; ( bash "$UNIT" "$@" >"$FIX/bg.$tag.out" 2>"$FIX/bg.$tag.err"; echo $? >"$FIX/bg.$tag.rc" ) & BGPID=$!; }
bgrc() { wait_for "${2:-90}" test -s "$FIX/bg.$1.rc" && cat "$FIX/bg.$1.rc"; }
# sleeper — a live "driver" pid for a unit; sets SLEEPER_PID.
sleeper() { "$FIX/bin/ship-loop-sleeper" & SLEEPER_PID=$!; SLEEPERS="$SLEEPERS $SLEEPER_PID"; }
unsleep() { kill "$@" 2>/dev/null; wait "$@" 2>/dev/null; }
# mk_state <ref> <host> [pid] [result status] [stage] [failovers] — a unit directory in
# ST_SPACE (ours by default); ST_LAUNCHED is its launched_at.
ST_SPACE="$SPACE" ST_LAUNCHED=1
mk_state() {
  local d="$ST_SPACE/notes/loops/$1"
  mkdir -p "$d"
  jq -n --arg r "$1" --arg h "$2" --argjson t "$ST_LAUNCHED" '{ref: $r, host: $h, branch: $r, worktree: "/nowhere", brief: "/b", class: "S", launched_at: $t}' > "$d/unit.json"
  [[ -z "${3:-}" ]] || { echo "$3" > "$d/driver.pid.tmp" && mv -f "$d/driver.pid.tmp" "$d/driver.pid"; }
  if [[ -n "${4:-}" ]]; then
    jq -n --arg r "$1" --arg s "$4" --arg st "${5:-finalize}" --argjson f "${6:-0}" '{ref: $r, status: $s, stage: $st, failovers: $f}' > "$d/result.json"
  fi
}
rm_loops() { local d; for d in "$1"/notes/loops/*; do [[ -d "$d" ]] && rm -rf "$d"; done; }

VER="$(jq -r .version "$PLUGIN_DIR/.claude-plugin/plugin.json")"
CACHE="$HOSTHOME/.cache/hyper/ship/$VER"

# 1: usage ------------------------------------------------------------------------------------
assert_eq "no subcommand: usage, exit 64" "64" "$(unit)"
assert_eq "unknown subcommand: 64" "64" "$(unit frob)"
assert_eq "internal subcommands need SHIP_UNIT_INTERNAL: _probe" "64" "$(unit _probe x)"
assert_eq "...and _launch" "64" "$(unit _launch x)"
assert_eq "...and _resume" "64" "$(unit _resume x)"
assert_eq "...and _driver" "64" "$(unit _driver x)"
assert_eq "run without a ref: 64" "64" "$(unit run --brief "$BRIEF" --class S)"
assert_eq "run without a brief: 64" "64" "$(unit run a1 --class S)"
assert_eq "run with a bad class: 64" "64" "$(unit run a1 --brief "$BRIEF" --class X)"
assert_eq "run with a bad ref: 64" "64" "$(unit run ../x --brief "$BRIEF" --class S)"
assert_eq "run with a missing brief: 64" "64" "$(unit run a1 --brief "$FIX/none.md" --class S)"
assert_eq "run with a bad --max-rounds: 64" "64" "$(unit run a1 --brief "$BRIEF" --class S --max-rounds 0)"
assert_eq "run with a bad model override: 64" "64" "$(unit run a1 --brief "$BRIEF" --class S --model nostage=opus)"
assert_eq "resume of an unknown unit: 70" "70" "$(unit resume ghost)"
assert_eq "wait for an unknown unit: 70" "70" "$(unit wait ghost)"
assert_eq "no worktree was made by any of those" "main" "$(cd "$SPACE/worktrees" && echo *)"

# wt (worktrunk) missing: run stops with 70 before any worktree, space or driver
# A PATH like ours with every wt hidden: a directory holding one is replaced by a copy made of symlinks.
mv "$FIX/bin/wt" "$FIX/bin/wt.off"
nowt_path="" nowt_n=0
IFS=: read -r -a _dirs <<<"$PATH"
for _d in "${_dirs[@]}"; do
  [[ -d "$_d" ]] || continue
  if [[ -e "$_d/wt" ]]; then
    nowt_n=$((nowt_n + 1)); mkdir -p "$FIX/nowt/$nowt_n"
    for _f in "$_d"/*; do [[ "$(basename "$_f")" == wt ]] || ln -sf "$_f" "$FIX/nowt/$nowt_n/" 2>/dev/null; done
    _d="$FIX/nowt/$nowt_n"
  fi
  nowt_path="${nowt_path:+$nowt_path:}$_d"
done
mode nowt ready
assert_eq "run without wt on PATH: 70" "70" "$(PATH="$nowt_path" unit run nowt --brief "$BRIEF" --class S)"
assert_contains "...says wt (worktrunk) is missing" "$(err)" "ship-unit: wt (worktrunk) not found on PATH"
assert_eq "...no worktree was made" "main" "$(cd "$SPACE/worktrees" && echo *)"
assert_eq "...no multiplexer space was opened" "0" "$(mux_count open)"
mv "$FIX/bin/wt.off" "$FIX/bin/wt"

# 2: a local run returns the driver's exit code ----------------------------------------------
mode l1 ready
rc="$(unit run l1 --brief "$BRIEF" --class S --max-rounds 2 --final-gate --model dev=sonnet)"
assert_eq "local run: READY exits 0" "0" "$rc"
assert_contains "wt branched from the remote base" "$(cat "$WT_LOG")" "$SPACE :: switch -c --no-cd -b origin/main l1"
assert_eq "the worktree exists" "yes" "$([[ -d "$SPACE/worktrees/l1" ]] && echo yes)"
assert_contains "result.json is printed" "$(out)" '"status":"READY"'
assert_eq "one ship-mux open" "1" "$(mux_count open)"
assert_eq "one ship-mux run" "1" "$(mux_count run)"
assert_contains "the driver ran in the unit pane (via _driver)" "$(jq -r 'select(.verb == "run") | .args[-1]' "$SHIP_MUX_FAKE_LOG" | head -n 1)" "_driver"
assert_contains "...with SHIP_UNIT_INTERNAL set for it" "$(jq -r 'select(.verb == "run") | .args[-1]' "$SHIP_MUX_FAKE_LOG" | head -n 1)" "SHIP_UNIT_INTERNAL=1"
assert_eq "driver.exit holds 0" "0" "$(cat "$(loops l1)/driver.exit")"
assert_eq "unit.json records the local host" "local" "$(jq -r .host "$(loops l1)/unit.json")"
assert_eq "unit.json records the branch" "l1" "$(jq -r .branch "$(loops l1)/unit.json")"
assert_eq "unit.json records the worktree" "$SPACE/worktrees/l1" "$(jq -r .worktree "$(loops l1)/unit.json")"
assert_eq "a local unit gets no config.json" "" "$([[ -e "$(loops l1)/config.json" ]] && echo yes)"
args1="$(cat "$FIX/loopargs.l1.1")"
assert_contains "driver got --worktree" "$args1" "$SPACE/worktrees/l1"
assert_contains "driver got --brief" "$args1" "$BRIEF"
assert_contains "driver got --max-rounds" "$args1" "--max-rounds"
assert_contains "driver got --final-gate" "$args1" "--final-gate"
assert_not_contains "the models do not go on the command line" "$args1" "--model"
assert_eq "...they reach the driver through models.override" "dev=sonnet" "$(cat "$FIX/loopmodels.l1.1")"
assert_eq "the driver saw host local" "local" "$(jq -r .host "$(loops l1)/result.json")"

# 2b: the driver runs with the PATH of the shell that ran ship-unit, not the pane's -----------
mkdir -p "$FIX/extra"
mode lp1 ready
rc="$(PATH="$FIX/extra:$PATH" unit run lp1 --brief "$BRIEF" --class S)"
assert_eq "run with a PATH prefix: READY exits 0" "0" "$rc"
assert_eq "the driver got the caller's PATH, prefix first" "$FIX/extra:$PATH" "$(cat "$FIX/looppath.lp1.1")"

# 2c: a failed wt switch -c leaves nothing behind, and a rerun starts clean ---------------------
mode wf1 ready
: > "$FIX/wt.fail"
rc="$(unit run wf1 --brief "$BRIEF" --class S)"
assert_eq "wt switch -c fails: exit 70" "70" "$rc"
assert_contains "...the wt error is in the message" "$(err)" "has no upstream information"
assert_contains "...and the message names the command" "$(err)" "wt switch -c wf1 failed"
assert_eq "...the branch this run created is gone" "no" "$(git -C "$G" rev-parse --verify -q refs/heads/wf1 >/dev/null && echo yes || echo no)"
assert_eq "...the worktree is gone" "no" "$([[ -e "$SPACE/worktrees/wf1" ]] && echo yes || echo no)"
assert_eq "...git no longer lists it" "" "$(git -C "$G" worktree list --porcelain | grep 'worktrees/wf1')"
assert_eq "...no driver was started" "0" "$(ls "$FIX"/loopargs.wf1.* 2>/dev/null | wc -l | tr -d ' ')"
rm -f "$FIX/wt.fail"
rc="$(unit run wf1 --brief "$BRIEF" --class S)"
assert_eq "the rerun starts clean and finishes READY" "0" "$rc"
assert_eq "...on a worktree it made itself" "yes" "$([[ -d "$SPACE/worktrees/wf1" ]] && echo yes)"

# a branch that already existed is kept; only the worktree this run made goes
git -C "$G" branch wf2 origin/main
mode wf2 ready
: > "$FIX/wt.fail"
rc="$(unit run wf2 --brief "$BRIEF" --class S)"
rm -f "$FIX/wt.fail"
assert_eq "wt switch of an existing branch fails: exit 70" "70" "$rc"
assert_eq "...the branch that was already there is kept" "yes" "$(git -C "$G" rev-parse --verify -q refs/heads/wf2 >/dev/null && echo yes || echo no)"
assert_eq "...the worktree this run made is gone" "no" "$([[ -e "$SPACE/worktrees/wf2" ]] && echo yes || echo no)"

# a later setup step failing (the multiplexer is unusable) removes what the run created too
mode wf3 ready
printf 'mux is down\n' > "$SHIP_MUX_FAKE_DIR/check-fail"
rc="$(unit run wf3 --brief "$BRIEF" --class S)"
rm -f "$SHIP_MUX_FAKE_DIR/check-fail"
assert_eq "a failing setup step after wt: non-zero exit" "70" "$rc"
assert_eq "...its branch is gone" "no" "$(git -C "$G" rev-parse --verify -q refs/heads/wf3 >/dev/null && echo yes || echo no)"
assert_eq "...its worktree is gone" "no" "$([[ -e "$SPACE/worktrees/wf3" ]] && echo yes || echo no)"

mode l2 park
rc="$(unit run l2 --brief "$BRIEF" --class M --branch feat-two)"
assert_eq "local run: a parked unit exits 2" "2" "$rc"
assert_eq "--branch names the worktree branch" "yes" "$([[ -d "$SPACE/worktrees/feat-two" ]] && echo yes)"
mode l3 error
assert_eq "local run: an ERROR driver exits 1" "1" "$(unit run l3 --brief "$BRIEF" --class S)"
assert_eq "...recorded in driver.exit" "1" "$(cat "$(loops l3)/driver.exit")"
# the new branch starts at origin/<base>, not at a stale local base
echo more > "$FIX/seed/more.txt"; git -C "$FIX/seed" add more.txt; git -C "$FIX/seed" commit -q -m "chore: more"; git -C "$FIX/seed" push -q origin main
mode l3b ready
unit run l3b --brief "$BRIEF" --class S >/dev/null
assert_eq "a new branch has the remote base's newest commit (fetched first)" "chore: more" "$(git -C "$SPACE/worktrees/l3b" log -1 --format=%s)"

# 3: resume writes the handoff files ----------------------------------------------------------
echo "use the existing helper" > "$FIX/answer.md"
assert_eq "resume --answer without a park: refused (3)" "3" "$(unit resume l1 --answer "$FIX/answer.md")"
assert_eq "...and wrote nothing" "answer-*" "$(cd "$(loops l1)" && echo answer-*)"
assert_eq "resume --extend without an over-budget stage: refused (3)" "3" "$(unit resume l1 --extend 10)"
assert_eq "...and wrote nothing" "" "$([[ -e "$(loops l1)/extend" ]] && echo extend)"
rc="$(unit resume l2 --answer "$FIX/answer.md" --model dev=sonnet,haiku)"
assert_eq "resume with an answer: the unit now ends READY (exit 0)" "0" "$rc"
assert_eq "answer-1.md holds the answer (park.json's n)" "use the existing helper" "$(cat "$(loops l2)/answer-1.md")"
assert_eq "models.override got the line" "dev=sonnet,haiku" "$(cat "$(loops l2)/models.override")"
assert_eq "the driver was started a second time" "2" "$(ls "$FIX"/loopargs.l2.* | wc -l | tr -d ' ')"
assert_eq "...with the same arguments as the first start" "$(cat "$FIX/loopargs.l2.1")" "$(cat "$FIX/loopargs.l2.2")"
assert_eq "driver.exit was rewritten" "0" "$(cat "$(loops l2)/driver.exit")"

# a park that is not number 1 gets answer-<n>.md
mode l6 park3
assert_eq "park n=3: parked (2)" "2" "$(unit run l6 --brief "$BRIEF" --class S)"
assert_eq "...resume --answer: READY" "0" "$(unit resume l6 --answer "$FIX/answer.md")"
assert_eq "...the answer is answer-3.md" "use the existing helper" "$(cat "$(loops l6)/answer-3.md")"
assert_eq "...and not answer-1.md" "" "$([[ -e "$(loops l6)/answer-1.md" ]] && echo yes)"
# LIMIT and DIALOG parks cannot be answered
mode l7 parklimit
unit run l7 --brief "$BRIEF" --class S >/dev/null
assert_eq "resume --answer on a LIMIT park: refused (3)" "3" "$(unit resume l7 --answer "$FIX/answer.md")"
assert_contains "...saying why" "$(err)" "usage limit"
assert_eq "...nothing written" "answer-*" "$(cd "$(loops l7)" && echo answer-*)"
mode l8 parkdialog
unit run l8 --brief "$BRIEF" --class S >/dev/null
assert_eq "resume --answer on a DIALOG park: refused (3)" "3" "$(unit resume l8 --answer "$FIX/answer.md")"
assert_contains "...saying why" "$(err)" "dialog"
assert_eq "a LIMIT park resumes without an answer, with a model override" "2" "$(unit resume l7 --model dev=haiku)"

mode l4 over
assert_eq "an over-budget unit exits 2" "2" "$(unit run l4 --brief "$BRIEF" --class S)"
assert_eq "resume --extend 20.5 continues it" "0" "$(unit resume l4 --extend 20.5)"
assert_eq "extend holds the minutes (the stub moved it to extend.applied)" "20.5" "$(cat "$(loops l4)/extend.applied")"
assert_eq "resume --extend with a bad number: 64" "64" "$(unit resume l4 --extend soon)"
assert_eq "resume --extend 0: 64" "64" "$(unit resume l4 --extend 0)"
assert_eq "resume --extend 0.0: 64" "64" "$(unit resume l4 --extend 0.0)"
assert_eq "resume --model with a bad stage: 64" "64" "$(unit resume l4 --model nostage=opus)"
assert_eq "resume --answer with an empty file: 64" "64" "$(: > "$FIX/empty.md"; unit resume l2 --answer "$FIX/empty.md")"
mode l4 ready
assert_eq "resume with nothing to hand over just restarts the driver" "0" "$(unit resume l4)"
assert_eq "...which was started a third time" "3" "$(ls "$FIX"/loopargs.l4.* | wc -l | tr -d ' ')"
# run's --model and resume's --model: the later one wins (ship-loop applies the file in order)
mode l5 park
unit run l5 --brief "$BRIEF" --class S --model dev=Y >/dev/null
assert_eq "run --model dev=Y: models.override holds Y" "dev=Y" "$(cat "$(loops l5)/models.override")"
assert_eq "resume with two --model options" "0" "$(unit resume l5 --answer "$FIX/answer.md" --model dev=X --model review=opus)"
assert_eq "...the file holds Y, then X (X wins), then review" "dev=Y|dev=X|review=opus" "$(paste -sd'|' "$(loops l5)/models.override")"
assert_eq "...and the driver read them in that order" "dev=Y|dev=X|review=opus" "$(paste -sd'|' "$FIX/loopmodels.l5.2")"
unit run l5 --brief "$BRIEF" --class S >/dev/null
assert_eq "a new run truncates models.override" "" "$(cat "$(loops l5)/models.override")"

# 4: slots and liveness ------------------------------------------------------------------------
rm_loops "$SPACE"
sleeper; S1=$SLEEPER_PID; sleeper; S2=$SLEEPER_PID
mk_state busy1 local "$S1"
mk_state busy2 local "$S2"
mode full1 ready
before_open="$(mux_count open)"
rc="$(unit run full1 --brief "$BRIEF" --class S)"
assert_eq "full slots: refused (3)" "3" "$rc"
assert_contains "...with a message naming the host and the slots" "$(err)" "host local is full: 2 of 2 slots"
assert_contains "...and the units in use" "$(err)" "busy1"
assert_eq "...no worktree was created" "" "$([[ -e "$SPACE/worktrees/full1" ]] && echo full1)"
assert_eq "...and no space was opened" "$before_open" "$(mux_count open)"
unsleep "$S2"
assert_eq "a dead driver.pid frees its slot" "0" "$(unit run full1 --brief "$BRIEF" --class S)"
rm -rf "$(loops full1)"
# pid reuse: a live pid that is not a ship process does not hold a slot
sleep 120 & OTHER=$!; SLEEPERS="$SLEEPERS $OTHER"
mk_state reused local "$OTHER"
mode full2 ready
assert_eq "a recycled pid (a live process that is not ours) frees the slot" "0" "$(unit run full2 --brief "$BRIEF" --class S)"
# a unit with driver.exit is finished, whatever its pid says
echo 0 > "$(loops busy1)/driver.exit"
mode full3 ready
assert_eq "a unit with driver.exit does not count" "0" "$(unit run full3 --brief "$BRIEF" --class S)"
rm -f "$(loops busy1)/driver.exit"
# the lead's own ship-unit processes are not drivers
mkdir -p "$FIX/lead"
printf '#!/usr/bin/env bash\nwhile :; do sleep 1; done\n' > "$FIX/lead/ship-unit"
bash "$FIX/lead/ship-unit" wait zz & LEADP=$!; SLEEPERS="$SLEEPERS $LEADP"
mk_state leadwait local "$LEADP"
mode full6 ready
assert_eq "a pid running 'ship-unit wait' is not a driver: its unit's slot is free" "0" "$(unit run full6 --brief "$BRIEF" --class S)"
unsleep "$LEADP"
rm -rf "$(loops leadwait)"
# starting units count
rm_loops "$SPACE"
unsleep "$S1" "$OTHER"
ST_LAUNCHED="$(date +%s)" mk_state starting1 local
ST_LAUNCHED="$(date +%s)" mk_state starting2 local
mode full4 ready
assert_eq "units launched a moment ago with no pid yet fill the slots (3)" "3" "$(unit run full4 --brief "$BRIEF" --class S)"
assert_contains "...named in the refusal" "$(err)" "starting1"
ST_LAUNCHED=$(( $(date +%s) - 3600 )) mk_state starting1 local
ST_LAUNCHED=$(( $(date +%s) - 3600 )) mk_state starting2 local
assert_eq "...but not once the grace period has passed" "0" "$(unit run full4 --brief "$BRIEF" --class S)"
# an empty driver.pid (a driver mid-start) is "starting", never dead
rm_loops "$SPACE"
ST_LAUNCHED="$(date +%s)" mk_state emp1 local
: > "$(loops emp1)/driver.pid"
probe() { SHIP_UNIT_INTERNAL=1 bash "$UNIT" _probe "$1" 2>/dev/null | sed -n "s/^ship-unit-probe: $1 //p"; }
assert_eq "an empty driver.pid within the grace period is starting" "starting" "$(probe emp1)"
ST_LAUNCHED="$(date +%s)" mk_state emp2 local
: > "$(loops emp2)/driver.pid"
mode full7 ready
assert_eq "...and two such units fill the slots" "3" "$(unit run full7 --brief "$BRIEF" --class S)"
rm_loops "$SPACE"
ST_LAUNCHED=$(( $(date +%s) - 3600 )) mk_state emp3 local
: > "$(loops emp3)/driver.pid"
assert_eq "an empty driver.pid long after the launch is dead" "dead" "$(probe emp3)"
# a live driver whose pid file flips between empty and whole is never read as dead
rm_loops "$SPACE"
sleeper; SF=$SLEEPER_PID
ST_LAUNCHED="$(date +%s)" mk_state flip1 local
( for _ in $(seq 1 200); do : > "$(loops flip1)/driver.pid"; echo "$SF" > "$(loops flip1)/driver.pid"; done ) &
FLIPPER=$!
dead_seen=0
for _ in $(seq 1 25); do [[ "$(probe flip1)" != dead ]] || dead_seen=$((dead_seen + 1)); done
wait "$FLIPPER" 2>/dev/null
assert_eq "a pid file that is empty for an instant never reads as dead (25 probes)" "0" "$dead_seen"
unsleep "$SF"
rm_loops "$SPACE"
# the unit's own ref is excluded; exactly at the limit
rm_loops "$SPACE"
sleeper; S3=$SLEEPER_PID; sleeper; S4=$SLEEPER_PID
mk_state mine local
mk_state o1 local "$S3"
mode mine park
assert_eq "resume with slots=2 and one other live unit: allowed" "0" "$(mode mine ready; unit resume mine)"
mk_state o2 local "$S4"
assert_eq "resume with 2 other live units at slots=2: refused (3)" "3" "$(unit resume mine)"
# the unit does not count itself
rm -rf "$(loops o2)"
echo "$S3" > "$(loops mine)/driver.pid"
rm -f "$(loops mine)/driver.exit"
assert_eq "resume of a unit whose driver is running: refused (3)" "3" "$(unit resume mine)"
assert_contains "...pointing at wait" "$(err)" "ship-unit wait mine"
rm -rf "$(loops o1)"
mode again ready
mk_state again local "$S4"
assert_eq "run refuses a unit whose driver is already running" "3" "$(unit run again --brief "$BRIEF" --class S)"
assert_contains "...pointing at wait" "$(err)" "ship-unit wait again"
unsleep "$S3" "$S4"
# another host's units do not count here
rm_loops "$SPACE"
sleeper; S5=$SLEEPER_PID; sleeper; S6=$SLEEPER_PID
mk_state bx1 box "$S5"
mk_state bx2 box "$S6"
mode full5 ready
assert_eq "two live units of host box do not fill the local host" "0" "$(unit run full5 --brief "$BRIEF" --class S)"
unsleep "$S5" "$S6"

# 4b: concurrent runs cannot overbook a host ------------------------------------------------------
rm_loops "$SPACE"; rm_loops "$HOSTSPACE"
mode c1 hold; mode c2 hold
bg c1 run c1 --brief "$BRIEF" --class S --host box
bg c2 run c2 --brief "$BRIEF" --class S --host box
wait_for 120 refused c1 c2
sleep 0.3
for t in c1 c2; do sed "s/^/# bg $t: /" "$FIX/bg.$t.err" >&2; done
rc1="$(cat "$FIX/bg.c1.rc" 2>/dev/null)"; rc2="$(cat "$FIX/bg.c2.rc" 2>/dev/null)"
assert_eq "two concurrent runs at slots=1: one is refused (3), the other is running" "yes" "$(pair_ok "$rc1" "$rc2")"
assert_eq "...and exactly one driver was started" "1" "$(mux_count run "$FIX/hostfake.log")"
if [[ "$rc1" == 3 ]]; then winner=c2; else winner=c1; fi
release "$winner"
assert_eq "...the other one runs to READY (0)" "0" "$(bgrc "$winner")"
# the same ref twice
rm_loops "$SPACE"; rm_loops "$HOSTSPACE"
rm -f "$FIX/bg."*
mode s1 hold
bg s1a run s1 --brief "$BRIEF" --class S --host box
wait_for 60 exists "$(hloops s1)/driver.pid"
assert_eq "a second run of a ref whose driver is up: refused (3)" "3" "$(unit run s1 --brief "$BRIEF" --class S --host box)"
assert_contains "...pointing at wait" "$(err)" "ship-unit wait s1"
release s1
assert_eq "...the first run is unaffected (0)" "0" "$(bgrc s1a)"
# a stale launch lock from a dead process is taken over
echo "99999999@$(hostname)" > "$SPACE/.hyper/ship-unit.lock"
mode lk ready
assert_eq "a launch lock held by a dead process is taken over" "0" "$(unit run lk --brief "$BRIEF" --class S)"
assert_eq "...and released after the launch" "" "$([[ -e "$SPACE/.hyper/ship-unit.lock" ]] && echo held)"
# a crashed holder and two waiters: the takeover is a rename, so exactly one gets in
rm_loops "$SPACE"; rm_loops "$HOSTSPACE"; rm -f "$FIX/bg."*
echo "99999999@$(hostname)" > "$HOSTSPACE/.hyper/ship-unit.lock"
mode k1 hold; mode k2 hold
bg k1 run k1 --brief "$BRIEF" --class S --host box
bg k2 run k2 --brief "$BRIEF" --class S --host box
wait_for 120 refused k1 k2
sleep 0.3
rk1="$(cat "$FIX/bg.k1.rc" 2>/dev/null)"; rk2="$(cat "$FIX/bg.k2.rc" 2>/dev/null)"
assert_eq "crashed lock holder, two waiters at slots=1: one is refused (3), the other is running" "yes" "$(pair_ok "$rk1" "$rk2")"
if [[ "$rk1" == 3 ]]; then kw=k2; else kw=k1; fi
release "$kw"
assert_eq "...the other runs to READY" "0" "$(bgrc "$kw")"

LOCAL_RUNS="$(mux_count run)"
# 5: host runs ---------------------------------------------------------------------------------
rm_loops "$SPACE"; rm_loops "$HOSTSPACE"
rm -f "$FIX/bg."* "$FIX/release."*
mode h1 hold
: > "$SSH_LOG"; : > "$RSYNC_LOG"
: > "$FIX/ssh.noise"
: > "$FIX/ssh.drop"
bg h1 run h1 --brief "$BRIEF" --class S --host box --spec-dir "$SPACE/notes/specs/feat" --model dev=Y
assert_eq "the host's driver is up" "yes" "$(wait_for 60 exists "$(hloops h1)/driver.pid" && echo yes)"
assert_eq "the unit is visible here while it runs (mirrored right after the start)" "yes" "$(wait_for 60 exists "$(loops h1)/unit.json" && echo yes)"
assert_eq "...with the host as recorded on the host" "box" "$(jq -r .host "$(loops h1)/unit.json")"
assert_eq "...and the host's worktree path" "$HOSTSPACE/worktrees/h1" "$(jq -r .worktree "$(loops h1)/unit.json")"
bash "$UNIT" list > "$FIX/list.out" 2>/dev/null
assert_contains "list shows the host unit RUNNING (the host was asked)" "$(grep '^h1 ' "$FIX/list.out")" "RUNNING"
assert_contains "...alive" "$(grep '^h1 ' "$FIX/list.out")" " yes"
release h1
assert_eq "host run: READY exits 0 (the probe noise and one ssh drop did not matter)" "0" "$(bgrc h1)"
assert_contains "...it reported the lost connection" "$(cat "$FIX/bg.h1.err")" "lost the connection to box"
assert_contains "...and the reconnect" "$(cat "$FIX/bg.h1.err")" "reconnected to box"
assert_eq "...the drop was consumed" "" "$([[ -e "$FIX/ssh.drop" ]] && echo left)"
rm -f "$FIX/ssh.noise"
assert_contains "result.json was printed" "$(cat "$FIX/bg.h1.out")" '"status":"READY"'
assert_eq "result.json was mirrored back, from the host" "box" "$(jq -r .host "$(loops h1)/result.json")"
assert_eq "driver.exit was mirrored back" "0" "$(cat "$(loops h1)/driver.exit")"
assert_eq "scripts were synced to the versioned cache on the host" "yes" "$([[ -x "$CACHE/scripts/ship/ship-unit" ]] && echo yes)"
assert_eq "...with the plugin layout (hyper-require-lib.sh)" "yes" "$([[ -f "$CACHE/scripts/hyper-require-lib.sh" ]] && echo yes)"
assert_eq "...and the defaults file" "yes" "$([[ -f "$CACHE/skills/ship/defaults.yml" ]] && echo yes)"
assert_eq "the brief reached the host's space" "# brief" "$(cat "$HOSTSPACE/notes/brief-a.md")"
assert_eq "the rulings file reached the host" "# rulings" "$(cat "$HOSTSPACE/notes/decisions.md")"
assert_eq "the spec dir reached the host" "# spec" "$(cat "$HOSTSPACE/notes/specs/feat/design.md")"
assert_eq "ship.yml was NOT sent (the host has none)" "" "$([[ -e "$HOSTSPACE/.hyper/ship.yml" ]] && echo yes)"
assert_not_contains "...no rsync of it either" "$(cat "$RSYNC_LOG")" "ship.yml"
assert_eq "the scripts were synced once for the whole run" "1" "$(grep -c 'rsync -a --delete .*/scripts/ship/ ' "$RSYNC_LOG" | tr -d ' ')"
assert_eq "the unit has a worktree on the HOST" "yes" "$([[ -d "$HOSTSPACE/worktrees/h1" ]] && echo yes)"
assert_eq "...and none here" "" "$([[ -d "$SPACE/worktrees/h1" ]] && echo yes)"
assert_contains "the host's wt branched from the host's origin/main" "$(cat "$WT_LOG")" "$HOSTSPACE :: switch -c --no-cd -b origin/main h1"
assert_contains "the driver was started from the synced cache copy" "$(jq -r 'select(.verb == "run") | .args[-1]' "$FIX/hostfake.log" | tail -n 1)" "$CACHE/scripts/ship/ship-unit"
assert_eq "the lead's multiplexer was never used for the host unit" "$LOCAL_RUNS" "$(mux_count run)"
assert_eq "config.json is in the unit's loop dir (mirrored back)" "1" "$(jq -r .hosts.box.slots "$(loops h1)/config.json")"
assert_eq "the driver was told where the config is" "$HOSTSPACE/notes/loops/h1/config.json" "$(sed -n 's/.*cfgfile=\([^ ]*\).*/\1/p' "$FIX/loopenv.h1.1")"
assert_eq "...and loaded the lead's config, not the host's own (no hosts there)" "slots=1" "$(sed -n 's/.*\(slots=[^ ]*\)$/\1/p' "$FIX/loopenv.h1.1")"
assert_eq "...SHIP_HOST=box" "box" "$(sed -n 's/^host=\([^ ]*\) .*/\1/p' "$FIX/loopenv.h1.1")"
assert_eq "run --model reached the host's models.override" "dev=Y" "$(cat "$(loops h1)/models.override")"
assert_eq "unit.json has the spec dir (as the host sees it)" "$HOSTSPACE/notes/specs/feat" "$(jq -r .spec_dir "$(loops h1)/unit.json")"
assert_eq "the same config holds on the host's own ship-unit (SHIP_CONFIG_JSON over ssh)" "yes" "$(grep -q 'SHIP_CONFIG_JSON' "$SSH_LOG" && echo yes)"

# host runs copy paths with spaces, quotes and non-ASCII characters ------------------------
WEIRD_BRIEF="$SPACE/notes/br ief's é.md"
WEIRD_RULINGS="$SPACE/notes/de cisions \"2\" é.md"
WEIRD_SPEC="$SPACE/notes/specs/fe at's é"
mkdir -p "$WEIRD_SPEC"
printf '# brief\xc3\xa9 \n\n' > "$WEIRD_BRIEF"
printf '# rulings\xc3\xa9\n' > "$WEIRD_RULINGS"
printf '# spec\xc3\xa9\n' > "$WEIRD_SPEC/de sign.md"
cp "$SPACE/.hyper/ship.yml" "$FIX/ship.yml.keep"
sed "s|^rulings: .*|rulings: 'notes/de cisions \"2\" é.md'|" "$FIX/ship.yml.keep" > "$SPACE/.hyper/ship.yml"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load
mode w1 ready
: > "$SSH_LOG"; : > "$RSYNC_LOG"
assert_eq "host run with spaces, quotes and non-ASCII in the brief, rulings and spec paths: 0" "0" "$(unit run w1 --brief "$WEIRD_BRIEF" --class S --host box --spec-dir "$WEIRD_SPEC")"
cp "$FIX/ship.yml.keep" "$SPACE/.hyper/ship.yml"
unset SHIP_CONFIG_JSON SHIP_CONFIG_LAYERS; ship_config_load
H_BRIEF="${WEIRD_BRIEF/#$SPACE/$HOSTSPACE}" H_RULINGS="${WEIRD_RULINGS/#$SPACE/$HOSTSPACE}" H_SPEC="${WEIRD_SPEC/#$SPACE/$HOSTSPACE}"
assert_eq "the brief reached the host byte-identical" "yes" "$(cmp -s "$WEIRD_BRIEF" "$H_BRIEF" && echo yes)"
assert_eq "the rulings file reached the host byte-identical" "yes" "$(cmp -s "$WEIRD_RULINGS" "$H_RULINGS" && echo yes)"
assert_eq "the spec dir file reached the host byte-identical" "yes" "$(cmp -s "$WEIRD_SPEC/de sign.md" "$H_SPEC/de sign.md" && echo yes)"
assert_contains "the host mkdir quoted the spec dir for the remote shell" "$(cat "$SSH_LOG")" "mkdir -p -- $(ship_sq "$WEIRD_SPEC")"
assert_eq "the host run mirrored the unit back" "READY" "$(jq -r .status "$(loops w1)/result.json")"
assert_eq "no stray files were made from a split path" "" "$([[ -e "$HOSTSPACE/notes/br" || -e "$HOSTSPACE/notes/de" || -e "$HOSTSPACE/notes/specs/fe" ]] && echo made)"

# host slots are the host's
sleeper; S7=$SLEEPER_PID
ST_SPACE="$HOSTSPACE" mk_state hbusy box "$S7"
mode h2 ready
assert_eq "host slots: box is full with one live unit (3)" "3" "$(unit run h2 --brief "$BRIEF" --class S --host box)"
assert_contains "...the message names box" "$(err)" "host box is full: 1 of 1 slots"
assert_eq "...the refusal leaves no unit.json behind" "" "$([[ -e "$(loops h2)/unit.json" ]] && echo left)"
unsleep "$S7"
rm -rf "$(hloops hbusy)"

mode h3 ready
assert_eq "host run: READY exits 0" "0" "$(unit run h3 --brief "$BRIEF" --class S --host box)"
assert_eq "host without an ssh destination: 70" "70" "$(unit run h4 --brief "$BRIEF" --class S --host nossh)"
assert_contains "...with a message" "$(err)" "no ssh destination"
assert_eq "an unknown host: 70" "70" "$(unit run h4 --brief "$BRIEF" --class S --host nowhere)"

# a host that is down when the run starts: nothing was started
: > "$FIX/ssh.down"
before_h="$(mux_count run "$FIX/hostfake.log")"
mode h5 hold
assert_eq "host down at start: 70" "70" "$(unit run h5 --brief "$BRIEF" --class S --host box)"
assert_contains "...says the scripts could not be copied" "$(err)" "could not copy"
assert_eq "...no unit was started" "$before_h" "$(mux_count run "$FIX/hostfake.log")"
assert_eq "...and no unit directory was left" "" "$([[ -e "$(loops h5)" ]] && echo left)"
rm -f "$FIX/ssh.down"

# the host stays unreachable: give up with 75, within a time bound, the driver keeps running
mode h7 hold
bg h7 run h7 --brief "$BRIEF" --class S --host box
wait_for 60 exists "$(hloops h7)/driver.pid"
wait_for 60 exists "$(loops h7)/unit.json"
: > "$FIX/ssh.down"
t0=$SECONDS
# bounded: a regression that waits forever fails here instead of hanging the suite
SHIP_UNIT_RECONNECT_SEC=1 bg w7 wait h7
rc="$(bgrc w7 20)"
if [[ -z "$rc" ]]; then pkill -P "$BGPID" 2>/dev/null; kill "$BGPID" 2>/dev/null; rc="hung"; fi
assert_eq "wait: a host that stays down is given up on (75)" "75" "$rc"
assert_eq "...within a few seconds" "yes" "$([[ $((SECONDS - t0)) -le 20 ]] && echo yes)"
assert_contains "...saying it gave up" "$(cat "$FIX/bg.w7.err")" "gave up reconnecting to box"
assert_contains "...and that wait reattaches" "$(cat "$FIX/bg.w7.err")" "ship-unit wait h7"
# the original run gives up too, after the default window: stop it by bringing ssh back
rm -f "$FIX/ssh.down"
release h7
assert_eq "the original run (which kept polling) ends with the driver's code (0)" "0" "$(bgrc h7)"

# the driver finishes while ssh is down; the code and content arrive after the reconnect
mode h8 hold
bg h8 run h8 --brief "$BRIEF" --class S --host box
wait_for 60 exists "$(hloops h8)/driver.pid"
: > "$FIX/ssh.down"
sleep 0.7     # longer than any probe already on its way
release h8
assert_eq "the host's driver finished while ssh was down" "yes" "$(wait_for 60 exists "$(hloops h8)/driver.exit" && echo yes)"
sleep 0.5
assert_eq "...the run is still waiting" "" "$(cat "$FIX/bg.h8.rc" 2>/dev/null)"
rm -f "$FIX/ssh.down"
assert_eq "...and returns the driver's code once ssh is back (0)" "0" "$(bgrc h8)"
assert_contains "...the mirrored result is there" "$(cat "$FIX/bg.h8.out")" '"status":"READY"'
assert_eq "...and the mirrored driver.exit" "0" "$(cat "$(loops h8)/driver.exit")"

# a lost connection while starting is 75 (the driver may be running), and wait reattaches
mode h9 hold
: > "$FIX/ssh.drop2"
cat > "$FIX/bin/ssh.real" < "$FIX/bin/ssh"; chmod +x "$FIX/bin/ssh.real"
# drop the first _launch call once, after the host has done the work
cat > "$FIX/bin/ssh" <<'STUB'
#!/usr/bin/env bash
if [[ -e "$FIX/ssh.drop2" && "$*" == *_launch* ]]; then
  rm -f "$FIX/ssh.drop2"
  "$FIX/bin/ssh.real" "$@" >/dev/null 2>&1
  exit 255
fi
exec "$FIX/bin/ssh.real" "$@"
STUB
chmod +x "$FIX/bin/ssh"
assert_eq "a connection lost during the start: 75" "75" "$(unit run h9 --brief "$BRIEF" --class S --host box)"
assert_contains "...says the driver may be running" "$(err)" "may be running"
assert_eq "...a unit.json stub lets wait find the unit" "yes" "$([[ -f "$(loops h9)/unit.json" ]] && echo yes)"
release h9
assert_eq "...wait reattaches and returns the driver's code (0)" "0" "$(unit wait h9)"
cp "$FIX/bin/ssh.real" "$FIX/bin/ssh"; chmod +x "$FIX/bin/ssh"

# resume on a host: the answer goes over, the host restarts the driver
mode h6 park
assert_eq "host run: parked exits 2" "2" "$(unit run h6 --brief "$BRIEF" --class S --host box)"
: > "$RSYNC_LOG"; : > "$SSH_LOG"
assert_eq "host resume --answer: READY (0)" "0" "$(unit resume h6 --answer "$FIX/answer.md" --model dev=X)"
assert_contains "the answer was staged for the host" "$(cat "$RSYNC_LOG")" "notes/loops/h6/.resume-answer"
assert_not_contains "ship.yml is not copied on resume either" "$(cat "$RSYNC_LOG")" "ship.yml"
assert_eq "answer-1.md is on the host" "use the existing helper" "$(cat "$(hloops h6)/answer-1.md")"
assert_eq "...and mirrored here" "use the existing helper" "$(cat "$(loops h6)/answer-1.md")"
assert_eq "the staging file is gone here" "" "$([[ -e "$(loops h6)/.resume-answer" ]] && echo left)"
assert_eq "...and on the host" "" "$([[ -e "$(hloops h6)/.resume-answer" ]] && echo left)"
assert_eq "resume --model reached the host" "dev=X" "$(cat "$(hloops h6)/models.override")"
assert_eq "resume loaded the lead's config on the host too" "slots=1" "$(sed -n 's/.*\(slots=[^ ]*\)$/\1/p' "$FIX/loopenv.h6.2")"
assert_eq "resume synced the scripts once (at its start) and not again" "1" "$(grep -c 'rsync -a --delete .*/scripts/ship/ ' "$RSYNC_LOG" | tr -d ' ')"
# resume of a host unit refused on the host (answer for a LIMIT park) leaves nothing behind
mode h10 parklimit
unit run h10 --brief "$BRIEF" --class S --host box >/dev/null
assert_eq "host resume --answer on a LIMIT park: refused (3)" "3" "$(unit resume h10 --answer "$FIX/answer.md")"
assert_eq "...the staged answer is gone here" "" "$([[ -e "$(loops h10)/.resume-answer" ]] && echo left)"
assert_eq "...and on the host" "" "$([[ -e "$(hloops h10)/.resume-answer" ]] && echo left)"
# a stale cache on the host: one more sync, then it works
rm -rf "$HOSTHOME/.cache"
: > "$RSYNC_LOG"
mode h11 ready
assert_eq "a host whose cache vanished is resynced at the start of a resume" "0" "$(mode h6 ready; unit resume h6)"
assert_eq "...with one sync" "1" "$(grep -c 'rsync -a --delete .*/scripts/ship/ ' "$RSYNC_LOG" | tr -d ' ')"

# 6: wait ---------------------------------------------------------------------------------------
mk_state done1 local "" READY
echo 0 > "$(loops done1)/driver.exit"
assert_eq "wait on a finished unit returns its code at once" "0" "$(unit wait done1)"
assert_contains "...and prints result.json" "$(out)" "READY"
rm_loops "$SPACE"
mk_state dead1 local 99999999
assert_eq "wait on a dead driver without an exit code or result: 70 (not forever)" "70" "$(unit wait dead1)"
assert_contains "...says so" "$(err)" "left no exit code"
# a dead driver with a result written since the launch
for s in "READY:0" "ERROR:1" "OVER-BUDGET:2" "PARKED:2"; do
  st="${s%%:*}"; want="${s##*:}"
  mk_state fb local 99999999 "$st"
  assert_eq "dead driver, no driver.exit, result $st: wait returns $want" "$want" "$(unit wait fb)"
  rm -rf "$(loops fb)"
done
# a result older than the launch says nothing about this run
ST_LAUNCHED=$(( $(date +%s) + 3600 )) mk_state fb2 local 99999999 READY
ST_LAUNCHED=$(( $(date +%s) + 3600 )) mk_state fb2 local 99999999 READY
touch -t 202001010000 "$(loops fb2)/result.json"
jq '.launched_at = ($t | tonumber)' --arg t "$(( $(date +%s) - 3600 ))" "$(loops fb2)/unit.json" > "$FIX/u.json" && cp "$FIX/u.json" "$(loops fb2)/unit.json"
assert_eq "dead driver, a result older than the launch: 70" "70" "$(unit wait fb2)"
rm -rf "$(loops fb2)"
# pid reuse with a result: the recycled pid does not make the unit "running"
sleep 120 & OTHER2=$!; SLEEPERS="$SLEEPERS $OTHER2"
mk_state reuse2 local "$OTHER2" READY
assert_eq "wait: a recycled pid is a dead driver (READY result: 0)" "0" "$(unit wait reuse2)"
unsleep "$OTHER2"
sleeper; S8=$SLEEPER_PID
mk_state wait1 local "$S8"
( sleep 0.7; echo 2 > "$(loops wait1)/driver.exit" ) &
assert_eq "wait on a live driver blocks until driver.exit appears (2)" "2" "$(unit wait wait1)"
unsleep "$S8"
echo 77 > "$(loops wait1)/driver.exit"
assert_eq "a driver exit code outside 0-2 is ship-unit's own failure (70)" "70" "$(unit wait wait1)"

# 7: list ---------------------------------------------------------------------------------------
rm_loops "$SPACE"; rm_loops "$HOSTSPACE"
mkdir -p "$SPACE/notes/loops/.done/old"
sleeper; S9=$SLEEPER_PID
mk_state ready1 local "" READY finalize 0
mk_state parked1 local "" PARKED develop 0
mk_state failed1 local "" READY finalize 2
: > "$(loops failed1)/failover-1.json"
mk_state deadpid1 local 99999999
mk_state running1 local "$S9"
echo x > "$(loops running1)/review-r1.prompt.md"
mk_state remote1 box "" READY finalize 0
line() { grep "^$1 " "$FIX/unit.out"; }
: > "$SSH_LOG"
assert_eq "list exits 0" "0" "$(unit list)"
assert_contains "list has a header" "$(out)" "REF"
assert_contains "READY unit" "$(line ready1)" "READY"
assert_contains "READY unit: stage" "$(line ready1)" "finalize"
assert_contains "READY unit: driver not alive" "$(line ready1)" " no"
assert_contains "PARKED unit" "$(line parked1)" "PARKED"
assert_contains "PARKED unit: stage" "$(line parked1)" "develop"
assert_eq "failed-over unit: failovers column is 2" "2" "$(line failed1 | awk '{print $5}')"
assert_eq "READY unit: failovers column is 0" "0" "$(line ready1 | awk '{print $5}')"
assert_contains "dead-pid unit is DEAD" "$(line deadpid1)" "DEAD"
assert_contains "dead-pid unit: not alive" "$(line deadpid1)" " no"
assert_contains "live driver is RUNNING" "$(line running1)" "RUNNING"
assert_contains "RUNNING: stage from the newest prompt" "$(line running1)" "review-r1"
assert_contains "RUNNING: alive" "$(line running1)" " yes"
assert_contains "host column" "$(line remote1)" "box"
assert_contains "a host unit the host does not know: not alive ('?' is for no answer)" "$(line remote1)" " no"
assert_eq "age column is a duration" "yes" "$([[ "$(line ready1 | awk '{print $6}')" =~ ^[0-9]+[mhd]$ ]] && echo yes)"
assert_not_contains ".done is not listed" "$(out)" "old"
unsleep "$S9"
# remote units: one probe per host, with all that host's refs
rm_loops "$SPACE"
sleeper; S10=$SLEEPER_PID; sleeper; S11=$SLEEPER_PID
for r in rb1 rb2; do mk_state "$r" box ""; ST_SPACE="$HOSTSPACE" mk_state "$r" box "$S10"; done
rm -f "$(hloops rb2)/driver.pid"
mk_state rc1 box2 ""
ST_SPACE="$HOSTSPACE" mk_state rc1 box2 "$S11"
: > "$SSH_LOG"
unit list >/dev/null
assert_eq "one _probe call per remote host" "2" "$(grep -c '_probe' "$SSH_LOG" | tr -d ' ')"
assert_eq "...box was asked about both its units in one call" "1" "$(grep '_probe' "$SSH_LOG" | grep 'fakehost ' | grep -c 'rb1.*rb2' | tr -d ' ')"
assert_contains "a live remote unit is RUNNING and alive" "$(line rb1)" "RUNNING"
assert_contains "a remote unit with no live driver is not" "$(line rb2)" " no"
assert_contains "the other host's unit is RUNNING" "$(line rc1)" "RUNNING"
: > "$FIX/ssh.down"
unit list >/dev/null
assert_contains "list with the host down: alive is '?'" "$(line rb1)" "?"
assert_eq "...and it still exits 0" "0" "$(unit list)"
rm -f "$FIX/ssh.down"
unsleep "$S10" "$S11"
rm_loops "$SPACE"; rm_loops "$HOSTSPACE"
unit list >/dev/null
assert_contains "list with no units says so" "$(out)" "(no units)"
assert_eq "...and left no temp directory behind" "0" "$(ls -d "${TMPDIR:-/tmp}"/ship-unit-list.* 2>/dev/null | wc -l | tr -d ' ')"

# 8: ship-land --host ---------------------------------------------------------------------------
rm -rf "$HOSTSPACE/notes/loops/.done"
mk_unit_land() { mk_state "$1" box "" "$2"; ST_SPACE="$HOSTSPACE" mk_state "$1" box "" "$2"; }
mk_unit_land j1 PARKED
: > "$SSH_LOG"; : > "$RSYNC_LOG"
land() { bash "$LAND" "$@" 2>"$FIX/land.err" >"$FIX/land.out"; echo $?; }
: > "$FIX/ssh.spy"
assert_eq "land --host: the remote refusal (not READY, 3) is the exit code" "3" "$(land j1 --host box)"
rm -f "$FIX/ssh.spy"
assert_contains "...the remote refused" "$(cat "$FIX/land.err")" "refused"
assert_eq "...the local land lock was held while the remote land ran" "held" "$(cat "$FIX/spy.out")"
assert_eq "...and released after" "" "$([[ -e "$SPACE/.hyper/ship-land.lock" ]] && echo held)"
assert_contains "...it ran over ssh" "$(cat "$SSH_LOG")" "ship-land"
assert_contains "...from the synced cache" "$(cat "$SSH_LOG")" ".cache/hyper/ship/$VER/scripts/ship/ship-land"
assert_contains "...with the space root exported" "$(cat "$SSH_LOG")" "SHIP_SPACE_ROOT"
assert_contains "...the lead's config went over ssh" "$(cat "$SSH_LOG")" "SHIP_CONFIG_JSON"
assert_not_contains "...no ship.yml was copied" "$(cat "$RSYNC_LOG")" "ship.yml"
assert_contains "...the scripts were rsynced first" "$(cat "$RSYNC_LOG")" "fakehost:.cache/hyper/ship/$VER/scripts/ship/"
assert_contains "...and notes/loops/j1 was mirrored back" "$(cat "$RSYNC_LOG")" "fakehost:$SPACE/notes/loops/j1/"
# --force is forwarded: without it the remote refuses (3); with it the land goes on and
# fails differently (the unit's worktree is not there: 1)
assert_eq "land --host without --force: 3" "3" "$(land j1 --host box)"
assert_eq "land --host --force goes past the READY check (and fails on the missing worktree: not 3)" "yes" "$(rc="$(land j1 --host box --force)"; [[ "$rc" != 3 && "$rc" != 0 ]] && echo yes)"
assert_contains "...the flag reached ssh" "$(grep ship-land "$SSH_LOG" | tail -n 1)" "--force"
assert_eq "land --host forwards --task (exit follows the remote)" "3" "$(land j1 --host box --task T-1 2>/dev/null)"
assert_contains "...the flag reached ssh" "$(grep ship-land "$SSH_LOG" | tail -n 1)" "T-1"

: > "$RSYNC_LOG"
assert_eq "land --abandon --host: 0" "0" "$(land j1 --abandon --host box)"
assert_contains "...the abandon flag reached the host" "$(cat "$SSH_LOG")" "--abandon"
assert_eq "...the loop dir moved to .done on the host" "yes" "$([[ -d "$HOSTSPACE/notes/loops/.done/j1" && ! -d "$(hloops j1)" ]] && echo yes)"
assert_eq "...and here (mirrored)" "yes" "$([[ -d "$SPACE/notes/loops/.done/j1" && ! -d "$(loops j1)" ]] && echo yes)"
assert_contains "...and .done/j1 was mirrored back" "$(cat "$RSYNC_LOG")" "fakehost:$SPACE/notes/loops/.done/j1/"
assert_eq "--host local lands locally (the remote path is not used)" "1" "$(: > "$SSH_LOG"; land nothing --abandon --host local; )"
assert_eq "...no ssh call" "0" "$(wc -l < "$SSH_LOG" | tr -d ' ')"
assert_eq "land --host without an ssh destination: 1" "1" "$(land j1 --host nossh)"
assert_contains "...says so" "$(cat "$FIX/land.err")" "no ssh destination"
mk_unit_land j2 READY
assert_eq "land --host with the host down: 1" "1" "$(: > "$FIX/ssh.down"; land j2 --host box)"
assert_eq "land --host: missing remote unit follows the remote exit (1)" "1" "$(rm -f "$FIX/ssh.down"; land absent --abandon --host box)"
assert_contains "...the remote said so" "$(cat "$FIX/land.err")" "nothing to abandon"
assert_eq "land with a bad --host: 2" "2" "$(land j2 --host '../x')"
assert_eq "land --host needs a value: 2" "2" "$(land j2 --host)"

finish
