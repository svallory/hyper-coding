/**
 * PATH with absolute entries only, for every drive command.
 *
 * A relative PATH entry (`./bin`, `./node_modules/.bin`, `.`, an empty entry,
 * an unexpanded `~/…`) resolves against the working directory. Run from a
 * space root, where `bin/` is synced content any peer can push, the commands'
 * own lookups — `bash` for hyper-lib.sh (`runLib`), `git` for every space
 * operation — would run that space's `bin/bash` or `bin/git` (PR #52 review,
 * H2; the agent-plugin hooks have the same rule in hyper-safe-path.sh).
 *
 * Applied once, in `BaseCommand.init()`, before a drive command runs; every
 * child inherits it. It covers the drive topics (`hyper space|drive|warp|
 * machine …`), not other `hyper` commands.
 */
import { delimiter, isAbsolute } from "node:path";

const FALLBACK = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** The absolute entries of `value`, in order; the system dirs when none is left. */
export function absolutePathEntries(value: string | undefined): string[] {
	const kept = (value ?? "").split(delimiter).filter((entry) => entry !== "" && isAbsolute(entry));
	return kept.length > 0 ? kept : FALLBACK;
}

/** Rewrite `env.PATH` (default: this process's) to its absolute entries. */
export function keepAbsolutePathEntries(env: NodeJS.ProcessEnv = process.env): void {
	env.PATH = absolutePathEntries(env.PATH).join(delimiter);
}
