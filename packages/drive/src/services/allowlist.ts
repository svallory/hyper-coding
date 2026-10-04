/**
 * The space allowlist renderer and secret guard.
 *
 * A space's history tracks an allowlist, not a blocklist: the rendered
 * `.gitignore` starts with `*` (ignore everything) and re-includes the
 * directories a space is made of — `notes/`, `data/`, `bin/`, `.hyper/`,
 * `.claude/` — plus the space's own marker files. `scratch/`, `worktrees/`,
 * `code/` and root-level loose files stay out of history by construction
 * (C-4). Extra entries from the space manifest's `tracked` list each add one
 * `!/<entry>` + `!/<entry>/**` pair.
 *
 * The secret patterns live next to the allowlist so both are reviewed
 * together (design.md, "Space branches"); `hyper space commit` (T-6) refuses
 * to stage any path `findSecretPaths` returns unless it was explicitly
 * allowed (C-7).
 */

import picomatch from "picomatch";
import { quoteForTerminal } from "#lib/terminal-text";

/**
 * The base allowlist, verbatim from design.md. Order matters: gitignore
 * rules apply last-match-wins, so the two re-ignores (`/.hyper/space.git/`,
 * `/.claude/settings.local.json`) must come after the `!` re-includes of
 * their parent trees.
 */
const BASE_ALLOWLIST: readonly string[] = [
	"*",
	"!/.gitignore",
	"!/HYPER.md",
	"!/AGENTS.md",
	"!/CLAUDE.md",
	"!/notes/",
	"!/notes/**",
	"!/data/",
	"!/data/**",
	"!/bin/",
	"!/bin/**",
	"!/.hyper/",
	"!/.hyper/**",
	"/.hyper/space.git/",
	"!/.claude/",
	"!/.claude/**",
	"/.claude/settings.local.json",
];

/**
 * The rules that must hold whatever a `tracked` entry says, re-emitted after
 * every `!` pair. They are in the base list too, but a tracked pair lands
 * after it and gitignore is last-match-wins: without this tail, `tracked:
 * ["extra"]` alone would be harmless, but the pair ordering that makes the
 * base list work would be one `!` away from re-including the space's own git
 * dir. Repeating the lines costs nothing (git ignores duplicates) and keeps
 * the invariant true by construction rather than by the refusal below.
 */
const SAFETY_TAIL: readonly string[] = ["/.hyper/space.git/", "/.claude/settings.local.json"];

/**
 * Paths a `tracked` entry may never name — the space's own git dir, the
 * project's repo, and the trees the allowlist exists to keep out of history.
 * Refused even though the safety tail would win the match: a silent override
 * is exactly the foot-gun this list prevents, and `hyper space init` should
 * tell the operator their `tracked` list is wrong instead of quietly ignoring
 * it.
 */
export const RESERVED_PATHS: readonly string[] = [
	".hyper/space.git", // the space's own git dir: its config holds the remote URL
	".git", // the project's repo
	"worktrees", // the project's worktrees (C-4)
	"code", // a multi-repo space's repos (C-4)
	"scratch", // throwaway by definition
	".claude/settings.local.json", // per-machine settings, not space material
];

/**
 * Gitignore-style globs that should never reach a space's history. `**`
 * crosses directories, so these match at any depth. Matching is
 * case-insensitive, because a checkout from a case-insensitive filesystem
 * (macOS's default) can turn `id_rsa` into `ID_RSA` on its own.
 *
 * `id_ed25519*` and `id_ecdsa*` are additions to design.md's list of six —
 * the same keys in different shapes, which the guard exists to keep out of
 * history; recorded in notes/specs/hyperdrive/deviations.md.
 */
export const SECRET_PATTERNS: readonly string[] = [
	"**/.env*",
	"**/*credentials*",
	"**/*.pem",
	"**/*.key",
	"**/*.pem~",
	"**/*.key~",
	"**/*.pem.*",
	"**/*.key.*",
	"**/id_rsa*",
	"**/id_ed25519*",
	"**/id_ecdsa*",
	"**/secrets/**",
];

/**
 * A `tracked` entry that cannot be rendered safely. Friendly, like
 * `SpaceGitError`: the message is the whole story and a stack would only
 * bury it. (T-9: `ConfigError` does not do this — worth aligning there.)
 */
export class AllowlistError extends Error {
	constructor(detail: string) {
		super(detail);
		this.name = "AllowlistError";
		// The message IS the whole story; a stack would only bury it.
		this.stack = this.message;
	}
}

/**
 * Characters that would change the meaning of the rendered `.gitignore`:
 * a newline can inject whole extra rules (a `tracked` entry of
 * `"a\n!/scratch/**"` would re-include `scratch/`), `!` negates, `*`/`?`/`[`
 * are globs, `#` starts a comment, `\` escapes. None of them belong in a
 * plain directory entry.
 */
const FORBIDDEN_IN_ENTRY: ReadonlyArray<readonly [string, string]> = [
	["\n", "a newline"],
	["\r", "a carriage return"],
	["#", "`#` (it starts a comment)"],
	["!", "`!` (it would negate a rule)"],
	["*", "`*` (it is a glob)"],
	["?", "`?` (it is a glob)"],
	["[", "`[` (it starts a character class)"],
	["\\", "`\\` (it escapes the next character)"],
];

/**
 * Reduce one `tracked` entry to the plain relative directory name the
 * allowlist renders (`./extra/` → `extra`), refusing anything that could change
 * the meaning of the rendered rules.
 *
 * Exported because callers keep a LIST: `hyper space init` merges the entry's
 * `--tracked` flags with what the space already has, and `extra` and `extra/`
 * have to collapse to one entry or the same directory gets rendered (and, once
 * stored, published) twice.
 */
export function normaliseTrackedEntry(raw: string): string {
	if (raw.trim() === "") {
		throw new AllowlistError(
			`A tracked entry can't be empty or just spaces, but I got ${quoteForTerminal(raw)}.`,
		);
	}
	if (raw !== raw.trim()) {
		// A leading or trailing space is invisible in the rendered file and
		// would never match a real path, so the entry would silently do nothing.
		throw new AllowlistError(
			`A tracked entry can't start or end with spaces, but ${quoteForTerminal(raw)} does. Give me the plain directory name.`,
		);
	}
	for (const [char, why] of FORBIDDEN_IN_ENTRY) {
		if (raw.includes(char)) {
			throw new AllowlistError(
				`A tracked entry can't contain ${why}, but ${quoteForTerminal(raw)} does. Give me a plain directory name instead.`,
			);
		}
	}

	let entry = raw;
	while (entry.startsWith("./")) entry = entry.slice(2);
	if (entry.startsWith("/")) {
		throw new AllowlistError(
			`A tracked entry must be relative to the space root, but ${quoteForTerminal(raw)} is absolute.`,
		);
	}
	while (entry.endsWith("/")) entry = entry.slice(0, -1);
	if (entry === "" || entry === ".") {
		throw new AllowlistError(
			`A tracked entry must name a directory inside the space, but I got ${quoteForTerminal(raw)}.`,
		);
	}
	if (entry.split("/").includes("..")) {
		throw new AllowlistError(
			`A tracked entry can't escape the space root, but ${quoteForTerminal(raw)} contains "..".`,
		);
	}
	// `a/./b` and `a//b` are the same paths to a filesystem and would render as
	// rules that match nothing — an entry that looks tracked but isn't.
	if (entry.split("/").some((segment) => segment === "" || segment === ".")) {
		throw new AllowlistError(
			`A tracked entry can't contain an empty or \`.\` segment, but ${quoteForTerminal(raw)} does. Write the path plainly, e.g. ${quoteForTerminal(
				entry
					.split("/")
					.filter((s) => s !== "" && s !== ".")
					.join("/"),
			)}.`,
		);
	}
	// Reserved: equal to one of them, or inside one of them (`.hyper/space.git/hooks`
	// is as revealing as the git dir itself). Case-insensitively, because a
	// case-insensitive filesystem would hand back either spelling.
	const lowered = entry.normalize("NFC").toLowerCase();
	for (const reserved of RESERVED_PATHS) {
		if (lowered === reserved || lowered.startsWith(`${reserved}/`)) {
			throw new AllowlistError(
				`${quoteForTerminal(raw)} is reserved — a space never tracks ${reserved} or anything under it. Remove it from the space's tracked list.`,
			);
		}
	}
	return entry;
}

/**
 * The line that marks a `.gitignore` as hyper's own render of the allowlist.
 *
 * It is a trailing comment so the design's rules keep the file's first line and
 * their order exactly as design.md writes them (C-4 is checked against them),
 * and it is what `hyper space init` recognises instead of comparing bytes: a
 * space that was initialised with `--tracked extra` holds a legitimate render
 * that differs from today's, and that is not a user's file.
 */
export const ALLOWLIST_MARKER =
	"# hyper space allowlist — written by `hyper space init`, re-rendered by --refresh";

/**
 * Does this `.gitignore` hold hyper's marker line?
 *
 * The test `hyper space init` uses to tell "hyper wrote this" from "the user
 * wrote this", so it answers YES for a render that differs from what today's
 * `--tracked` would produce — which is the whole point.
 */
export function isHyperAllowlist(contents: string): boolean {
	return contents.split("\n").some((line) => line.trim() === ALLOWLIST_MARKER);
}

/**
 * Render the space's tracked `.gitignore`: the base allowlist plus one
 * `!/<entry>` + `!/<entry>/**` pair per extra `tracked` entry, the safety tail
 * when a tracked pair could shadow it, and the marker line last. Entries are
 * normalised (`./x/` → `x`) by {@link normaliseTrackedEntry}; absolute paths,
 * `..` escapes, empty or `.` segments, surrounding spaces, globs, comment or
 * negation characters, newlines and empty entries are refused — a `tracked`
 * entry is a plain directory name, and anything else could rewrite the
 * allowlist or render a rule that matches nothing. Deterministic, trailing
 * newline, and free of duplicates apart from the safety tail, which is
 * deliberately re-emitted after the tracked pairs (see SAFETY_TAIL).
 */
export function renderGitignore(tracked: string[] = []): string {
	const lines: string[] = [...BASE_ALLOWLIST];
	const seen = new Set(lines);
	for (const raw of tracked) {
		const entry = normaliseTrackedEntry(raw);
		for (const line of [`!/${entry}/`, `!/${entry}/**`]) {
			if (seen.has(line)) continue;
			seen.add(line);
			lines.push(line);
		}
	}
	// Only when a tracked pair could shadow them: with no tracked entries the
	// base list is already verbatim (and C-4 checks it line for line), so the
	// tail would add nothing but noise.
	if (tracked.length > 0) lines.push(...SAFETY_TAIL);
	lines.push(ALLOWLIST_MARKER);
	return `${lines.join("\n")}\n`;
}

/**
 * Which of `paths` look like secrets: matches against SECRET_PATTERNS,
 * minus the exact relative paths listed in `allow`. Input order is kept.
 */
export function findSecretPaths(paths: string[], allow: string[] = []): string[] {
	const allowed = new Set(allow);
	// dot: `**` must reach dot-directories (`.config/.env`). nocase: a
	// checkout from a case-insensitive filesystem (macOS by default) can hand
	// back `ID_RSA` or `Credentials.json` for a lowercase name on disk.
	const matchers = SECRET_PATTERNS.map((pattern) =>
		picomatch(pattern, { dot: true, nocase: true }),
	);
	return paths.filter((path) => {
		// Match portable filename semantics, but retain the original exact override/path.
		const normalised = path
			.split("/")
			.map((part) => part.replace(/[ .]+$/, ""))
			.join("/");
		return !allowed.has(path) && matchers.some((match) => match(normalised));
	});
}
