#!/usr/bin/env bash
# Test runner: executes tests/test-*.sh under bash (never zsh), prints each
# file's TAP-ish assertion lines, and exits non-zero when anything fails.
# Dependencies: bash, git, node, perl (per-file process groups and timeouts),
# and coreutils.
#
# Usage: bash tests/run.sh [--affected [base]] [--jobs N] [--budget S]
#                          [--shuffle] [--dry-run] [files...]
#   (no args)         run every tests/test-*.sh
#   files...          run only those (names or paths); the one-file dev loop
#   --affected [base] run the files the change since `git merge-base base HEAD`
#                     affects (committed + uncommitted + untracked), chosen by
#                     tests/affected.map; base defaults to origin/main
#   --jobs N          run N files at once (default 1); every file keeps its own
#                     process group, TMPDIR and output; blocks print on completion
#   --budget S        fail when one file takes more than S seconds (default 300,
#                     0 disables)
#   --shuffle         random file order (order-independence check)
#   --dry-run         print the selection and exit without running anything
#   --paths-from F    with --affected: read the changed paths from F ("-" =
#                     stdin) instead of git (selection tests)
#
# Environment:
#   HYPER_TEST_FILE_TIMEOUT  seconds before a file's process group is killed (600)
#   HYPER_TEST_CLI           auto|build|skip|require: what to do when the built
#                            hyper CLI is missing and a selected file needs it
#                            (default auto: build when the monorepo is here,
#                            else skip those files with a visible SKIP line)

set -u

# Nothing the caller exported may steer the tests: the ship driver exports
# SHIP_CONFIG_JSON / SHIP_CONFIG_LAYERS / SHIP_SPACE_ROOT into its gate (hyper-655).
for v in $(compgen -e SHIP_); do unset "$v"; done
unset HYPER_SPACE_ROOT

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$dir/../.." && pwd)"

# Files that need the built hyper CLI (they source hyper-lib.sh through it).
CLI_FILES="${HYPER_TEST_CLI_FILES:-test-a-detection.sh test-c-memory-seed.sh test-g-audit.sh test-h-adopt.sh test-i-convert.sh test-k-cleanup.sh test-l-legacy.sh test-m-init.sh test-n-context.sh test-o-require-lib.sh test-p-drive-hook.sh test-q-hyper-md-backup.sh test-t-ship-config.sh}"
# Build order from agent-plugin/CLAUDE.md.
CLI_BUILD_ORDER="ui core create-hyper-hq kit hq gen drive cli"

affected=0 base="" jobs=1 budget=300 shuffle=0 dry=0 paths_from=""
explicit=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --affected)
      affected=1
      if [[ $# -gt 1 && "$2" != -* && ! -e "$2" && "$2" != test-*.sh ]]; then base="$2"; shift; fi ;;
    --jobs)   jobs="${2:?--jobs needs a number}"; shift ;;
    --budget) budget="${2:?--budget needs seconds}"; shift ;;
    --paths-from) paths_from="${2:?--paths-from needs a file}"; shift ;;
    --shuffle) shuffle=1 ;;
    --dry-run) dry=1 ;;
    -h|--help) sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "run.sh: unknown option $1" >&2; exit 2 ;;
    *) explicit+=("$1") ;;
  esac
  shift
done
case "$jobs" in ''|*[!0-9]*|0) echo "run.sh: --jobs wants a positive number" >&2; exit 2 ;; esac
case "$budget" in ''|*[!0-9]*) echo "run.sh: --budget wants seconds" >&2; exit 2 ;; esac
base="${base:-origin/main}"

is_cli_file() { case " $CLI_FILES " in *" $1 "*) return 0 ;; esac; return 1; }

# ---- selection ---------------------------------------------------------------
all_files=()
for f in "$dir"/test-*.sh; do [[ -f "$f" ]] && all_files+=("$(basename "$f")"); done

selected=()   # basenames
select_add() { # <name>; ignores duplicates and files that do not exist
  local n="$1" s
  [[ -f "$dir/$n" ]] || return 0
  for s in ${selected[@]+"${selected[@]}"}; do [[ "$s" == "$n" ]] && return 0; done
  selected+=("$n")
}

changed_paths() {
  if [[ -n "$paths_from" ]]; then
    if [[ "$paths_from" == "-" ]]; then cat; else cat "$paths_from"; fi
    return
  fi
  local top mb
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || { echo "run.sh: not in a git repository" >&2; return 2; }
  mb="$(git -C "$top" merge-base "$base" HEAD 2>/dev/null)" || { echo "run.sh: no merge base with '$base' (fetch it, or pass another base)" >&2; return 2; }
  { git -C "$top" diff --name-only "$mb"; git -C "$top" ls-files --others --exclude-standard; } | sort -u
}

if [[ $affected -eq 1 ]]; then
  paths="$(changed_paths)" || exit 2
  if [[ -z "$paths" ]]; then
    echo "affected: nothing changed since $base"
    exit 0
  fi
  everything=0
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    matched="" targets=""
    while IFS= read -r line; do
      line="${line%%#*}"
      set -f; set -- $line; set +f
      [[ $# -ge 2 ]] || continue
      glob="$1"; shift
      # shellcheck disable=SC2254
      case "$p" in $glob) matched="$glob"; targets="$*"; break ;; esac
    done < "$dir/affected.map"
    if [[ -z "$matched" ]]; then
      echo "affected: $p: not covered by the plugin suite"
      continue
    fi
    case " $targets " in
      *" NONE "*) echo "affected: $p -> nothing (rule $matched)"; continue ;;
      *" ALL "*)  echo "affected: $p -> ALL (rule $matched): shared or unmapped plugin file changed, running everything"
                  everything=1; continue ;;
    esac
    echo "affected: $p -> ${targets//SELF/$(basename "$p")} (rule $matched)"
    for t in $targets; do
      case "$t" in
        SELF) select_add "$(basename "$p")" ;;
        CLI)  for c in $CLI_FILES; do select_add "$c"; done ;;
        *)    select_add "$t" ;;
      esac
    done
  done <<< "$paths"
  if [[ $everything -eq 1 ]]; then
    selected=(${all_files[@]+"${all_files[@]}"})
  fi
  if [[ ${#selected[@]} -eq 0 ]]; then
    echo "affected: nothing selected"
    exit 0
  fi
  # run in a stable order
  sorted="$(printf '%s\n' "${selected[@]}" | sort)"
  selected=(); while IFS= read -r n; do selected+=("$n"); done <<< "$sorted"
  echo "affected: ${#selected[@]} of ${#all_files[@]} test files selected"
elif [[ ${#explicit[@]} -gt 0 ]]; then
  for a in "${explicit[@]}"; do
    if [[ -f "$a" ]]; then a="$(basename "$a")"; fi
    if [[ ! -f "$dir/$a" ]]; then echo "run.sh: no such test file: $a" >&2; exit 2; fi
    select_add "$a"
  done
else
  selected=("${all_files[@]}")
fi

if [[ $shuffle -eq 1 && ${#selected[@]} -gt 0 ]]; then
  sorted="$(printf '%s\n' "${selected[@]}" | perl -MList::Util=shuffle -e 'print shuffle(<STDIN>)')"
  selected=(); while IFS= read -r n; do selected+=("$n"); done <<< "$sorted"
fi

if [[ $dry -eq 1 ]]; then
  printf 'would run: %s\n' "${selected[*]-}"
  exit 0
fi

# ---- environment -------------------------------------------------------------
# C-12: no test may reach a real multiplexer server. SHIP_MUX_TEST=1 makes the
# Herdr backend exit 99 before anything else, and a `herdr` stub that fails
# loudly sits first on PATH in case anything else calls the command directly.
stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/hyper-herdr-stub.XXXXXX")"
work="$(mktemp -d "${TMPDIR:-/tmp}/hyper-run.XXXXXX")"
trap 'rm -rf "$stub_dir" "$work"' EXIT
cat > "$stub_dir/herdr" <<'STUB'
#!/bin/sh
echo "herdr stub: a test called the real herdr command; this must never run" >&2
exit 97
STUB
chmod +x "$stub_dir/herdr"
export SHIP_MUX_TEST=1
export PATH="$stub_dir:$PATH"

file_timeout="${HYPER_TEST_FILE_TIMEOUT:-600}"

echo "# rsync: $(rsync --version 2>/dev/null | head -1 || true)"

# ---- the hyper CLI (hyper-4at) -----------------------------------------------
cli_mode="${HYPER_TEST_CLI:-auto}"
case "$cli_mode" in auto|build|skip|require) ;; *) echo "run.sh: HYPER_TEST_CLI must be auto|build|skip|require" >&2; exit 2 ;; esac

cli_ready() {
  [[ -e "$root/packages/cli/bin/run.js" ]] && bash "$dir/hyper" space lib-path >/dev/null 2>&1
}

needs_cli=0
for n in ${selected[@]+"${selected[@]}"}; do is_cli_file "$n" && needs_cli=1; done
cli_skip=0
if [[ $needs_cli -eq 1 && "$cli_mode" != skip ]] && ! cli_ready; then
  have_tree=0; [[ -f "$root/packages/cli/package.json" ]] && have_tree=1
  instructions="build it: cd $root && bun install && for p in $CLI_BUILD_ORDER; do (cd packages/\$p && bun run build); done"
  case "$cli_mode" in
    require) echo "run.sh: the hyper CLI is not built (HYPER_TEST_CLI=require); $instructions" >&2; exit 2 ;;
    build)   [[ $have_tree -eq 1 ]] || { echo "run.sh: HYPER_TEST_CLI=build but $root/packages/cli is missing" >&2; exit 2; } ;;
    auto)    [[ $have_tree -eq 1 ]] || cli_skip=1 ;;
  esac
  if [[ $cli_skip -eq 0 ]]; then
    echo "# building the hyper CLI (first run in this worktree)"
    t0=$(date +%s)
    build_ok=1
    {
      [[ -d "$root/node_modules" ]] || (cd "$root" && bun install --frozen-lockfile) || build_ok=0
      if [[ $build_ok -eq 1 ]]; then
        for p in $CLI_BUILD_ORDER; do
          (cd "$root/packages/$p" && bun run build) || { build_ok=0; break; }
        done
      fi
    } >"$work/cli-build.log" 2>&1
    echo "# CLI build took $(( $(date +%s) - t0 ))s"
    if [[ $build_ok -eq 0 ]] || ! cli_ready; then
      tail -15 "$work/cli-build.log" | sed 's/^/# build: /'
      if [[ "$cli_mode" == auto ]]; then cli_skip=1; echo "# CLI build failed; files that need it are skipped"
      else echo "run.sh: the hyper CLI build failed (see above); $instructions" >&2; exit 2; fi
    fi
  fi
elif [[ $needs_cli -eq 1 && "$cli_mode" == skip ]]; then
  cli_skip=1
fi

# ---- running -----------------------------------------------------------------
# run_one <index> <name>: one file in its own process group, TMPDIR and output
# file. On timeout the whole group gets TERM, then KILL, so no child outlives
# the file to write into a later file's results; the TMPDIR is removed
# afterwards. Output goes to a file, not a command substitution, so a leaked
# background child holding a pipe cannot keep the runner waiting. The finished
# block is printed under a lock so concurrent files never interleave.
run_one() {
  local idx="$1" name="$2" f="$dir/$2" outfile ftmp status out t0 secs p q s crashed=0 block
  outfile="$work/$idx.out"
  block="$work/$idx.block"
  t0=$(date +%s)
  if [[ $cli_skip -eq 1 ]] && is_cli_file "$name"; then
    out="ok - $name # SKIP hyper CLI not built"
    status=0
  else
    ftmp="$work/tmp-$idx"
    mkdir -p "$ftmp"
    TMPDIR="$ftmp" perl -e '
      my ($t, @cmd) = @ARGV;
      my $pid = fork();
      if (!$pid) { setpgrp(0, 0); open(STDIN, "<", "/dev/null"); exec @cmd; exit 127 }
      $SIG{ALRM} = sub {
        kill "TERM", -$pid; select(undef, undef, undef, 1);
        kill "KILL", -$pid; waitpid($pid, 0); exit 142;
      };
      alarm $t; waitpid($pid, 0); my $st = $?; alarm 0;
      kill "KILL", -$pid;   # stragglers left in the group
      exit($st & 127 ? 128 + ($st & 127) : $st >> 8);
    ' "$file_timeout" bash "$f" >"$outfile" 2>&1
    status=$?
    rm -rf "$ftmp"
    out="$(cat "$outfile")"
    if [[ $status -eq 142 ]]; then
      out="$out"$'\n'"not ok - $name timed out after ${file_timeout}s"
    fi
  fi
  secs=$(( $(date +%s) - t0 ))
  if [[ $budget -gt 0 && $secs -gt $budget ]]; then
    out="$out"$'\n'"not ok - $name took ${secs}s, over the ${budget}s per-file budget"
  fi
  p="$(printf '%s\n' "$out" | grep -c '^ok ')"
  q="$(printf '%s\n' "$out" | grep -c '^not ok ')"
  s="$(printf '%s\n' "$out" | grep -c '^ok .*# SKIP')"
  # A file that dies before reporting (syntax error, crashed fixture setup)
  # must still fail the suite, not vanish silently.
  {
    echo "# === $name"
    printf '%s\n' "$out" | sed 's/^/    /'
    echo "    # time: $name ${secs}s"
    if [[ $status -ne 0 && $q -eq 0 ]]; then
      echo "    # FILE CRASHED: exited $status without reporting a failed assertion"
      crashed=1
    fi
    echo
  } > "$block"
  echo "$p $q $crashed $secs $s $name" > "$work/$idx.cnt"
  until mkdir "$work/print.lock" 2>/dev/null; do sleep 0.05; done
  cat "$block"
  rmdir "$work/print.lock"
}

if [[ ${#selected[@]} -gt 0 ]]; then
  # FIFO semaphore: one token per running file.
  mkfifo "$work/sem"
  exec 9<>"$work/sem"
  for ((i = 0; i < jobs; i++)); do printf 'x' >&9; done
  idx=0
  for name in "${selected[@]}"; do
    idx=$((idx + 1))
    read -r -n1 -u 9 _tok
    ( run_one "$idx" "$name"; printf 'x' >&9 ) &
  done
  wait
  exec 9>&-
fi

total_pass=0 total_fail=0 crashed=0 skipped=0 files=0
timings=""
for c in "$work"/*.cnt; do
  [[ -f "$c" ]] || continue
  read -r p q cr secs s name < "$c"
  files=$((files + 1))
  total_pass=$((total_pass + p)); total_fail=$((total_fail + q))
  crashed=$((crashed + cr)); skipped=$((skipped + s))
  timings="$timings$secs $name"$'\n'
done

if [[ -n "$timings" ]]; then
  slow="$(printf '%s' "$timings" | sort -rn | head -5 | awk '{printf "%s%s %ss", (NR>1?", ":""), $2, $1}')"
  echo "# slowest: $slow"
fi
echo "# $files files, $((total_pass + total_fail)) assertions: $total_pass passed, $total_fail failed, $crashed crashed, $skipped skipped"

if [[ $total_fail -eq 0 && $crashed -eq 0 && $files -gt 0 ]]; then
  exit 0
fi
exit 1
