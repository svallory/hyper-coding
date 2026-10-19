# shellcheck shell=bash disable=SC2154,SC2120
# Shared by warp.sh and sync.sh (source it; it is not a runnable e2e script, and
# run.sh's script list never names it). The disposable ssh target both suites
# talk to: one Debian image with sshd, rsync and git, whose account's HOME is a
# path chosen by the caller. Two scripts, ONE image: the recipe below hashes to
# the tag, so whichever suite runs first builds it and the other reuses it.
#
# The caller defines `die`, `image` and `work_real` first, and a `podman`
# (the binary, or a shell function wrapping it).

# sha12: first 12 hex of sha256. shasum is a perl script (macOS ships it;
# minimal Linux may not) — fall back to coreutils sha256sum. Both print the
# same hex, so the recipe tag is stable.
sha12() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else sha256sum "$@"; fi | cut -c1-12; }

# build_ssh_target_image: writes the Containerfile and entrypoint under
# $work_real and builds the image unless a tag with this exact recipe exists.
# Sets $derived to the tag.
build_ssh_target_image() {
echo "# podman version"
podman --version
containerfile="$work_real/Containerfile"
cat > "$containerfile" <<CONTAINERFILE
FROM $image
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \\
      openssh-server rsync git ca-certificates \\
    && rm -rf /var/lib/apt/lists/*
# No systemd here: warp does not need one. The entrypoint prepares the sshd
# runtime and execs it in the foreground, which is all this container does.
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CONTAINERFILE

cat > "$work_real/entrypoint.sh" <<'ENTRYPOINT'
#!/bin/sh
# The account's HOME is the SHARED path, not /home/<user>: sshd reads the home
# out of the passwd database, so a home created anywhere else would leave sshd
# looking for authorized_keys under a directory this harness never populates.
set -e
home_dir="$1"
useradd -d "$home_dir" -s /bin/bash svallory
mkdir -p "$home_dir"
# chown by USER only: this Debian image does not necessarily create a group of
# the same name, and the account primary group is what matters anyway.
chown -R svallory "$home_dir"
# Every component of the path must be traversable by the account.
d="$home_dir"
while [ "$d" != "/" ]; do chmod 0755 "$d" 2>/dev/null || true; d=$(dirname "$d"); done
# StrictModes is off for one reason: the shared path lives under a
# world-writable /tmp, which StrictModes would refuse. This container is
# disposable, reachable only on a mapped localhost port, and authenticates with
# a throwaway key that exists nowhere else — nothing here is worth protecting.
echo "StrictModes no" >> /etc/ssh/sshd_config
mkdir -p /run/sshd
ssh-keygen -A >/dev/null 2>&1 || true
exec /usr/sbin/sshd -D -e
ENTRYPOINT
chmod +x "$work_real/entrypoint.sh"

recipe="$(cat "$containerfile" "$work_real/entrypoint.sh" | sha12)"
derived="hyper-t12-e2e:$recipe"
if ! podman image exists "$derived"; then
  echo "# building $derived from $image (sshd + rsync + git)"
  podman build --tag "$derived" --file "$containerfile" "$work_real" >/dev/null \
    || die "could not build the container image"
fi
}

# ensure_podman_machine: start the podman VM when this platform has one
# (macOS/Windows). On Linux `podman machine` is unsupported and exits non-zero;
# podman is native there.
ensure_podman_machine() {
  if [ "$(uname -s)" != Linux ] && podman machine list --format '{{.Running}}' >/dev/null 2>&1; then
    if ! podman machine list --format '{{.Running}}' | grep -q true; then
      echo "# starting the podman machine"
      podman machine start >/dev/null
    fi
  fi
}
