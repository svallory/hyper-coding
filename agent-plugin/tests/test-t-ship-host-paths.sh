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
  assert_ok "pull dir [$name]" ship_host_pull_dir fakehost "$rem" "$dst"
  assert_ok "...byte-identical to the host's copy [$name]" diff -r "$rem" "$dst"
  assert_eq "...local-only files are removed [$name]" "" "$([[ -e "$dst/stale local.txt" ]] && echo left)"
done

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
