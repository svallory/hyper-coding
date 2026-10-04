/**
 * Subordinate uid/gid ranges for the agent's user namespace — shared by the
 * root script that adds a range and the check that reads it, so the two cannot
 * disagree about what "free" and "overlapping" mean.
 *
 * A range is never a fixed constant. Debian's `useradd` gives the first user
 * exactly 100000:65536, and `usermod --add-subuids` does not check for overlap,
 * so a hard-coded 100000-165535 for an agent with no range of its own mapped
 * BOTH users' containers onto the same host uids (security review, finding 2):
 * the agent's container processes could then signal the primary's and own its
 * files. So:
 *
 * - a new range starts at the highest start+count in /etc/subuid AND
 *   /etc/subgid (never below 100000), which is free in both files, so the agent
 *   gets the same start in each;
 * - an agent range that overlaps ANY other entry is refused, naming both lines;
 * - an agent range that does not overlap is left exactly as it is.
 *
 * POSIX sh and POSIX awk only: the same text runs in the root script (bash), in
 * the read-only check (`sh -c` as the primary; both files are world-readable),
 * and in the unit tests on macOS.
 */

/** How many ids a new range holds. */
export const SUBID_COUNT = 65536;

/** The lowest start a new range may have: below it are real users' uids. */
export const SUBID_FLOOR = 100000;

/**
 * The highest start a new range may have.
 *
 * Subordinate ids are 32-bit and 4294967295 is the reserved "no uid" value
 * ((uid_t)-1), so the last id of a range (start + count − 1) must stay at or
 * below 4294967294 — one below 2^32, not at it. A range ending on 4294967295 is
 * accepted by `usermod` (measured in the review's container) but rejected
 * later, when start + count wraps to 0 in the kernel's map write, leaving the
 * agent's rootless containers unable to start with no refusal from hyper. Above
 * this bound `usermod` also fails with "invalid subordinate uid range"
 * (measured, rc 3); either way the caller refuses with a clear message instead.
 */
export const SUBID_MAX_START = 4294967295 - SUBID_COUNT;

/**
 * Shell functions. Owner fields in these files may be a name or a numeric uid,
 * so the agent is matched by either.
 *
 * - `subid_conflict FILE USER UID`: prints "<agent line> overlaps <other line>"
 *   for the first overlap, nothing otherwise.
 * - `subid_has FILE USER UID`: exit 0 when the agent has a range in FILE.
 * - `subid_start_of FILE USER UID`: the agent's first range start in FILE.
 * - `subid_free_at FILE START COUNT`: exit 0 when no entry in FILE overlaps.
 * - `subid_next_free`: the next start free in both files.
 */
export const SUBID_FUNCTIONS = `subid_conflict() {
  [ -f "$1" ] || return 0
  awk -F: -v user="$2" -v uid="$3" '
    NF >= 3 && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
      n++; owner[n] = $1; first[n] = $2 + 0; count[n] = $3 + 0; text[n] = $0
    }
    END {
      for (i = 1; i <= n; i++) {
        if (owner[i] != user && owner[i] != uid) continue
        for (j = 1; j <= n; j++) {
          if (owner[j] == user || owner[j] == uid) continue
          if (first[i] < first[j] + count[j] && first[j] < first[i] + count[i]) {
            printf "%s overlaps %s\\n", text[i], text[j]
            exit
          }
        }
      }
    }' "$1"
}
subid_has() {
  [ -f "$1" ] || return 1
  awk -F: -v user="$2" -v uid="$3" '($1 == user || $1 == uid) && NF >= 3 { found = 1 } END { exit !found }' "$1"
}
subid_start_of() {
  awk -F: -v user="$2" -v uid="$3" '($1 == user || $1 == uid) && NF >= 3 { print $2; exit }' "$1"
}
subid_free_at() {
  [ -f "$1" ] || return 0
  awk -F: -v start="$2" -v count="$3" '
    NF >= 3 && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ && $2 + 0 < start + count && start + 0 < $2 + $3 { busy = 1 }
    END { exit busy }' "$1"
}
subid_next_free() {
  # A missing file is empty; an unreadable existing file must fail closed.
  # The root script has pipefail, so awk's result and cat failures both count.
  {
    for file in /etc/subuid /etc/subgid; do
      if [ -e "$file" ]; then cat "$file" || return 1; fi
    done
  } | awk -F: -v floor=${SUBID_FLOOR} -v count=${SUBID_COUNT} -v max=${SUBID_MAX_START} '
    BEGIN { top = floor }
    NF >= 3 && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { end = $2 + $3; if (end > top) top = end }
    END {
      # No room for a whole range before the end of the 32-bit id space: fail
      # rather than print an invalid or wrapped start. The caller turns this
      # into a clear refusal.
      if (top > max) exit 1
      printf "%.0f\\n", top
    }'
}`;
