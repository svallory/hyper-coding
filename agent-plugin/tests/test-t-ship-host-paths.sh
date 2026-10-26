#!/usr/bin/env bash
# Row T (lib-host.sh) — host mode copies any real path. The real rsync runs against a
# fake ssh that runs the "remote" command on this machine, so the remote-shell and
# rsync argument handling of whichever rsync is installed is what gets tested. No
# real remote, multiplexer or network is touched.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
set +eu
set +o pipefail

SHIP_DIR="$SCRIPTS_DIR/ship"
# shellcheck source=../scripts/ship/lib.sh
source "$SHIP_DIR/lib.sh"
# shellcheck source=../scripts/ship/lib-host.sh
source "$SHIP_DIR/lib-host.sh"

mkdir -p "$FIX/bin"
export SSH_LOG="$FIX/ssh.log"
# Like ssh: drop the options and the destination, join the rest, run it in a shell.
cat > "$FIX/bin/ssh" <<'STUB'
#!/bin/bash
echo "ssh $*" >> "$SSH_LOG"
while [[ "$1" == -o ]]; do shift 2; done
shift
exec /bin/sh -c "$*"
STUB
chmod +x "$FIX/bin/ssh"
export PATH="$FIX/bin:$PATH"

# Names with a space, a single quote, a double quote, a dollar sign, a glob character,
# a leading dash and non-ASCII characters.
NAMES=("plain" "with space" "it's" 'say "hi"' 'cash $HOME `x`' 'star*[a]?' "-dash" "café é" "tab	name")
n=0
for name in "${NAMES[@]}"; do
  n=$((n + 1))
  src="$FIX/lead/$n/$name"
  mkdir -p "$src/sub dir"
  # siblings a glob-expanded remote path would also match
  case "$name" in
    'star*[a]?') mkdir -p "$FIX/host/$n/star_a_"; echo sib > "$FIX/host/$n/star_a_/sib.txt" ;;
  esac
  printf 'brief %s\n\n  ' "$name" > "$src/file one.md"
  printf '\x00\x01\xff bin' > "$src/sub dir/b.bin"

  # push a directory and a file to the same absolute path
  assert_ok "push dir [$name]" ship_host_push fakehost "$src"
  assert_ok "push file [$name]" ship_host_push fakehost "$src/file one.md"
  assert_eq "no stray sibling made from a split path [$name]" "$name" "$(ls "$FIX/lead/$n")"

  # mirror back: a host-side directory (same machine, other root) comes to a local one
  rem="$FIX/host/$n/$name"
  mkdir -p "$rem/sub dir"
  cp "$src/file one.md" "$rem/file one.md"
  cp "$src/sub dir/b.bin" "$rem/sub dir/b.bin"
  : > "$rem/only-on-host é.txt"
  dst="$FIX/back/$n/$name"
  mkdir -p "$dst"
  : > "$dst/stale local.txt"
  if [[ "$name" == 'star*[a]?' ]]; then
    mkdir -p "$FIX/back/$n/star_a_"; echo mine > "$FIX/back/$n/star_a_/local.txt"
  fi
  assert_ok "pull dir [$name]" ship_host_pull_dir fakehost "$rem" "$dst"
  assert_ok "...byte-identical to the host's copy [$name]" diff -r "$rem" "$dst"
  assert_eq "...local-only files are removed [$name]" "" "$([[ -e "$dst/stale local.txt" ]] && echo left)"
done

# glob characters in the remote source are literal: the pull mirrors only the named
# directory and --delete keeps the local siblings the glob would have matched
for pair in "a?b|axb" "Decisions [draft]|Decisions d" "x*y|xzzy" 'back\slash|backXslash' 'q*\z|qaaaz' 'p[1\]|p1'; do
  lit="${pair%%|*}" sib="${pair##*|}"
  mkdir -p "$FIX/gh/$lit/in" "$FIX/gh/$sib/in" "$FIX/gl/$lit" "$FIX/gl/$sib"
  echo remote-lit > "$FIX/gh/$lit/in/f.txt"; echo remote-sib > "$FIX/gh/$sib/in/f.txt"
  echo local-sib > "$FIX/gl/$sib/keep.txt"; echo local-sib2 > "$FIX/gl/$sib/in.txt"
  assert_ok "pull [$lit] with a glob-matching sibling" ship_host_pull_dir fakehost "$FIX/gh/$lit" "$FIX/gl/$lit"
  assert_eq "...mirrors the literal directory [$lit]" "remote-lit" "$(cat "$FIX/gl/$lit/in/f.txt")"
  assert_eq "...nothing of the sibling came in [$lit]" "yes" "$([[ ! -e "$FIX/gl/$lit/keep.txt" && "$(ls "$FIX/gl/$lit")" == in ]] && echo yes)"
  assert_eq "...and the local sibling is untouched [$lit]" "local-sib" "$(cat "$FIX/gl/$sib/keep.txt")"
done
assert_eq "_ship_rsync_glob_esc escapes * ? [ ] and backslash" 'a\*\?\[\]\\z' "$(_ship_rsync_glob_esc 'a*?[]\z')"
assert_eq "...but leaves a path without them alone" 'a\z' "$(_ship_rsync_glob_esc 'a\z')"

# an rsync that cannot do -s (openrsync, rsync 2.x) is refused with its cause
mkdir -p "$FIX/oldbin"
printf '#!/bin/sh\necho "openrsync: protocol version 29"\necho "rsync version 2.6.9 compatible"\n' > "$FIX/oldbin/rsync"
chmod +x "$FIX/oldbin/rsync"
msg="$(unset _SHIP_HOST_RSYNC_CHECKED; PATH="$FIX/oldbin:$PATH" ship_host_pull_dir fakehost "$FIX/gh/a?b" "$FIX/gl/none" 2>&1)"; rc=$?
assert_eq "openrsync: the pull is refused" "1" "$rc"
assert_contains "...naming openrsync" "$msg" "openrsync"
assert_contains "...and saying to install rsync 3 first on PATH" "$msg" "install rsync 3"
assert_eq "...nothing was created" "" "$([[ -e "$FIX/gl/none" ]] && echo made)"
for fn in "ship_host_push fakehost $FIX/lead/1/plain" "ship_host_sync fakehost"; do
  assert_fails "openrsync: refused by $fn" env PATH="$FIX/oldbin:$PATH" SHIP_PLUGIN_ROOT="$PLUGIN_DIR" bash -c "source '$SHIP_DIR/lib.sh'; source '$SHIP_DIR/lib-host.sh'; $fn"
done
printf '#!/bin/sh\necho "rsync  version 2.6.8  protocol version 29"\n' > "$FIX/oldbin/rsync"
msg="$(unset _SHIP_HOST_RSYNC_CHECKED; PATH="$FIX/oldbin:$PATH" ship_host_pull_dir fakehost "$FIX/gh/a?b" "$FIX/gl/none" 2>&1)"
assert_contains "rsync below 3.0 is refused too" "$msg" "rsync 3.0 or newer"

# the ssh mkdir quoted the path for the remote shell
assert_contains "ssh mkdir single-quotes a path with a space" "$(cat "$SSH_LOG")" "mkdir -p -- '$FIX/lead/2/with space'"
assert_contains "...and escapes a single quote" "$(cat "$SSH_LOG")" "mkdir -p -- '$FIX/lead/3/it'\\''s'"

# a pull creates a missing local directory with a odd name
assert_ok "pull into a missing local dir" ship_host_pull_dir fakehost "$FIX/host/2/with space" "$FIX/new dir/it's é"
assert_eq "...and copied the file" "yes" "$([[ -f "$FIX/new dir/it's é/file one.md" ]] && echo yes)"

# a newline cannot be made safe: refused before anything runs, with a message that names it
: > "$SSH_LOG"
NL="$FIX/lead/new
line"
mkdir -p "$NL"
assert_fails "push refuses a path with a newline" ship_host_push fakehost "$NL"
assert_fails "...also among good paths" ship_host_push fakehost "$FIX/lead/1/plain" "$NL"
assert_fails "pull refuses a remote dir with a newline" ship_host_pull_dir fakehost "$NL" "$FIX/back/nl"
assert_eq "...no ssh call was made" "0" "$(wc -l < "$SSH_LOG" | tr -d ' ')"
assert_eq "...and nothing was created locally" "" "$([[ -e "$FIX/back/nl" ]] && echo made)"
msg="$(ship_host_push fakehost "$NL" 2>&1)"
assert_contains "the refusal says why" "$msg" "newline"
assert_not_contains "...and no longer lists the old character set" "$msg" "letters, digits"

# ship_sq round-trips through a shell
for name in "${NAMES[@]}" "a'b'c" "'" ""; do
  assert_eq "ship_sq round-trips [$name]" "$name" "$(/bin/sh -c "printf %s $(ship_sq "$name")")"
done

finish
