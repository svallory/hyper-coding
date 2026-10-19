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
import { CLAUDE_USER_STATE, CLAUDE_USER_STATE_ANYWHERE } from "#config/schema";
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
 * history; recorded in notes/specs/hyperdrive/deviations.md. So are
 * `.claude.json*` (Claude's account state, which carries MCP server `env`
 * values) and `shell-snapshots/` (captures of a shell's environment), which
 * are refused anywhere in a space, inside a `.claude/` or not.
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
	"**/.claude.json*",
	"**/shell-snapshots/**",
];

/** One content rule: a name to report and a single-line regex. */
export interface SecretContentPattern {
	name: string;
	regex: RegExp;
}

/**
 * A private key block header: PEM/OpenSSH (RSA, EC, OPENSSH, ENCRYPTED, bare)
 * and PGP's `PRIVATE KEY BLOCK`. The label is bounded (at most three words) so
 * a very long line cannot make the match quadratic. Shared with the 4 KiB
 * header check that stands in for files the content scan skips.
 */
export const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?-----/;

/** Keywords of the generic rules: not glued to a letter or digit before them. */
const SECRET_WORD = "(?<![A-Za-z0-9])(?:password|passwd|token|secret|api[_-]?key)[A-Za-z_-]{0,20}";

/**
 * Content shapes that mean a file holds a credential, whatever its name. Each
 * regex is tested against one line (no `g` flag, so no state). A hit is
 * reported as `path:line (name)`; the matched text is never kept or printed.
 * A false positive is waived per path (`--allow-secret`).
 *
 * Only UTF-8 text is scanned: a file with a NUL byte in its first 4 KiB is
 * treated as binary, which includes UTF-16 text (it is skipped, not scanned).
 */
export const SECRET_CONTENT_PATTERNS: readonly SecretContentPattern[] = [
	// A PEM/OpenSSH/PGP private key block header.
	{ name: "private key block", regex: PRIVATE_KEY_HEADER },
	// GitHub classic and OAuth/app tokens: ghp_, gho_, ghu_, ghs_, ghr_ + 36 chars.
	{ name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
	// GitHub fine-grained personal access token.
	{ name: "GitHub fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
	// Anthropic API key (checked before the generic `sk-` rule so it gets its own name).
	{ name: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
	// OpenAI-style secret keys (`sk-`, `sk-proj-`): a long body holding a digit,
	// so kebab-case identifiers made of words do not match.
	{ name: "API key (sk-)", regex: /\bsk-(?!ant-)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/ },
	// AWS access key id: long-term (AKIA) or temporary (ASIA) + 16 upper-case alphanumerics.
	{ name: "AWS access key id", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
	// Slack bot, user, app, refresh, config and legacy tokens (xoxb-, xoxp-, xoxa-, xoxr-,
	// xoxe-) and app-level tokens (xapp-1-...).
	{ name: "Slack token", regex: /\b(?:xox[bpare]-|xapp-\d-)[A-Za-z0-9-]{10,}/ },
	// Slack incoming webhook URL: the path is the credential.
	{
		name: "Slack webhook URL",
		regex: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{10,}/,
	},
	// npm automation/publish token: npm_ + 36 alphanumerics.
	{ name: "npm token", regex: /\bnpm_[A-Za-z0-9]{36}\b/ },
	// Assignment: DB_PASSWORD=, export API_TOKEN=, aws_secret_access_key = ... a 12+ char
	// value. `$`, `{`, quotes and spaces end the value, so `token=${TOKEN}` and prose do not match.
	{
		name: "generic secret assignment",
		regex: new RegExp(`${SECRET_WORD}["']?\\s*=\\s*["']?[^\\s"'$\`{}]{12,}`, "i"),
	},
	// `key: value` form: YAML `password: ...` and JSON `"password": "..."`, 16+ chars.
	{
		name: "generic secret value (key: value)",
		regex: new RegExp(`${SECRET_WORD}["']?\\s*:\\s*["']?[^\\s"'$\`{}]{16,}`, "i"),
	},
];

/** Where, and by which rule, a file's text looks like a credential. No value. */
export interface SecretContentHit {
	line: number;
	pattern: string;
}

/**
 * Which lines of `text` match SECRET_CONTENT_PATTERNS: at most one hit per
 * line and rule, in line order. Never returns the matched text.
 */
export function findSecretContent(text: string): SecretContentHit[] {
	const hits: SecretContentHit[] = [];
	const lines = text.split(/\r\n|\r|\n/);
	for (let i = 0; i < lines.length; i++) {
		for (const { name, regex } of SECRET_CONTENT_PATTERNS) {
			if (regex.test(lines[i])) hits.push({ line: i + 1, pattern: name });
		}
	}
	return hits;
}

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

/** One matcher per user-state entry: the entry itself and anything below it. */
function entryMatcher(entry: string): (path: string) => boolean {
	return picomatch([entry, `${entry}/**`], { dot: true, nocase: true });
}
const ANYWHERE_MATCHERS = CLAUDE_USER_STATE_ANYWHERE.map(entryMatcher);
const TOP_ONLY = CLAUDE_USER_STATE.filter((entry) => !CLAUDE_USER_STATE_ANYWHERE.includes(entry));
const TOP_ONLY_MATCHERS = TOP_ONLY.map(entryMatcher);

/**
 * Is `path` (relative to the space root) Claude Code user state? Unmistakable
 * names ({@link CLAUDE_USER_STATE_ANYWHERE}) count under a `.claude/` at any
 * depth; generic ones only in the space's top-level `.claude/`.
 * Case-insensitive, like the secret guard, because a case-insensitive
 * filesystem can hand back either spelling.
 *
 * Enforced in code at every commit, pull, clone, push and status
 * (`space-sync.ts`, `space-history.ts`, `space-incoming.ts`), not by the
 * rendered `.gitignore`: an incoming tip can replace that file or plant
 * tracked files (ac-gaps r2, B1).
 */
export function isClaudeUserStatePath(path: string): boolean {
	const segments = path.split("/");
	for (let i = 0; i < segments.length - 1; i++) {
		if (segments[i].toLowerCase() !== ".claude") continue;
		const rest = segments.slice(i + 1).join("/");
		if (ANYWHERE_MATCHERS.some((match) => match(rest))) return true;
		if (i === 0 && TOP_ONLY_MATCHERS.some((match) => match(rest))) return true;
	}
	return false;
}

/**
 * `git add` / `git status` pathspecs that leave out every user-state path: one
 * `:(exclude,glob,icase)` pair per entry (the entry and everything below it),
 * at any depth for the unmistakable names, at the top-level `.claude/` for the
 * generic ones. Always run from the space root.
 */
export function claudeUserStateExcludes(): string[] {
	return [
		...CLAUDE_USER_STATE_ANYWHERE.flatMap((entry) => [
			`:(exclude,glob,icase)**/.claude/${entry}`,
			`:(exclude,glob,icase)**/.claude/${entry}/**`,
		]),
		...TOP_ONLY.flatMap((entry) => [
			`:(exclude,glob,icase,top).claude/${entry}`,
			`:(exclude,glob,icase,top).claude/${entry}/**`,
		]),
	];
}
