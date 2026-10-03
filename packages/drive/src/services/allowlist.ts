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
 * Gitignore-style globs that should never reach a space's history. `**`
 * crosses directories, so these match at any depth.
 */
export const SECRET_PATTERNS: readonly string[] = [
	"**/.env*",
	"**/*credentials*",
	"**/*.pem",
	"**/*.key",
	"**/id_rsa*",
	"**/secrets/**",
];

/**
 * A `tracked` entry that cannot be rendered safely. Friendly, like
 * `ConfigError`: the message is the whole story and the stack adds nothing.
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

function normalizeTrackedEntry(raw: string): string {
	if (raw.trim() === "") {
		throw new AllowlistError(
			`A tracked entry can't be empty or just spaces, but I got ${JSON.stringify(raw)}.`,
		);
	}
	if (raw !== raw.trim()) {
		// A leading or trailing space is invisible in the rendered file and
		// would never match a real path, so the entry would silently do nothing.
		throw new AllowlistError(
			`A tracked entry can't start or end with spaces, but ${JSON.stringify(raw)} does. Give me the plain directory name.`,
		);
	}
	for (const [char, why] of FORBIDDEN_IN_ENTRY) {
		if (raw.includes(char)) {
			throw new AllowlistError(
				`A tracked entry can't contain ${why}, but ${JSON.stringify(raw)} does. Give me a plain directory name instead.`,
			);
		}
	}

	let entry = raw;
	while (entry.startsWith("./")) entry = entry.slice(2);
	if (entry.startsWith("/")) {
		throw new AllowlistError(
			`A tracked entry must be relative to the space root, but ${JSON.stringify(raw)} is absolute.`,
		);
	}
	while (entry.endsWith("/")) entry = entry.slice(0, -1);
	if (entry === "" || entry === ".") {
		throw new AllowlistError(
			`A tracked entry must name a directory inside the space, but I got ${JSON.stringify(raw)}.`,
		);
	}
	if (entry.split("/").includes("..")) {
		throw new AllowlistError(
			`A tracked entry can't escape the space root, but ${JSON.stringify(raw)} contains "..".`,
		);
	}
	// `a/./b` and `a//b` are the same paths to a filesystem and would render as
	// rules that match nothing — an entry that looks tracked but isn't.
	if (entry.split("/").some((segment) => segment === "" || segment === ".")) {
		throw new AllowlistError(
			`A tracked entry can't contain an empty or \`.\` segment, but ${JSON.stringify(raw)} does. Write the path plainly, e.g. ${JSON.stringify(
				entry
					.split("/")
					.filter((s) => s !== "" && s !== ".")
					.join("/"),
			)}.`,
		);
	}
	return entry;
}

/**
 * Render the space's tracked `.gitignore`: the base allowlist plus one
 * `!/<entry>` + `!/<entry>/**` pair per extra `tracked` entry. Entries are
 * normalised (`./x/` → `x`); absolute paths, `..` escapes, empty or `.`
 * segments, surrounding spaces, globs, comment or negation characters,
 * newlines and empty entries are refused — a `tracked` entry is a plain
 * directory name, and anything else could rewrite the allowlist or render a
 * rule that matches nothing. Deterministic, trailing newline, no duplicates.
 */
export function renderGitignore(tracked: string[] = []): string {
	const lines: string[] = [...BASE_ALLOWLIST];
	const seen = new Set(lines);
	for (const raw of tracked) {
		const entry = normalizeTrackedEntry(raw);
		for (const line of [`!/${entry}/`, `!/${entry}/**`]) {
			if (seen.has(line)) continue;
			seen.add(line);
			lines.push(line);
		}
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Which of `paths` look like secrets: matches against SECRET_PATTERNS,
 * minus the exact relative paths listed in `allow`. Input order is kept.
 */
export function findSecretPaths(paths: string[], allow: string[] = []): string[] {
	const allowed = new Set(allow);
	// dot: globs like `**/*credentials*` must also reach dot-directories.
	const matchers = SECRET_PATTERNS.map((pattern) => picomatch(pattern, { dot: true }));
	return paths.filter((path) => !allowed.has(path) && matchers.some((match) => match(path)));
}
