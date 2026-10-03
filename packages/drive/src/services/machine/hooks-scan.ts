/**
 * What the user's Claude Code hooks need on a machine.
 *
 * A user's `settings.json` is the best evidence of which CLIs their agent work
 * actually depends on: the hooks call `bd`, `rtk`, `jq` and `bun` by name, and
 * nothing else on the machine records that. So setup reads those files and
 * preselects what they mention.
 *
 * Three questions, answered separately, because the three mean different things
 * to the user:
 *
 * - `preselect` — a tool in the registry. `rtk-rewrite.sh` means `rtk` is needed,
 *   even though the first word of that command is a path.
 * - `configSync` — a hook under `~/.claude/hooks/`. It isn't missing: it arrives
 *   when `~/.claude` is synced, so setup says "sync config" rather than
 *   "clone".
 * - `resolvesAfterClone` — some other path inside the user's home (tempad's
 *   `w5-stop.sh`), which exists once the space is cloned on this machine.
 * - `unknown` — a bare word that is none of the above. The user decides; setup
 *   says what it saw and nothing more.
 *
 * Everything here is read-only: these files are the user's, and setup never
 * edits a Claude config.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { findTool } from "./tools.js";

/** What a scan found. */
export interface HookScan {
	/** Registry ids the hooks imply. */
	preselect: string[];
	/** Bare words that aren't in the registry. */
	unknown: string[];
	/** Paths under the user's home that will exist after the space is cloned. */
	resolvesAfterClone: string[];
	/** Hooks under `~/.claude/hooks/` — they arrive with a config sync. */
	configSync: string[];
	/** The files that were read, for the report and for debugging a wrong scan. */
	files: string[];
	/** Things that could not be read, said rather than swallowed. */
	warnings: string[];
}

/**
 * Words that are never a missing tool: shell syntax and the shell's own words.
 *
 * `bash`/`sh`/`node` run the hook and tell us nothing; `cd`, `printf` and `[`
 * are syntax. `bun` is in the registry and does get preselected. This list is
 * the difference between a scan that says "unknown: `[`" and one that says
 * nothing.
 */
const TRANSPARENT = new Set([
	"if",
	"then",
	"elif",
	"else",
	"fi",
	"do",
	"done",
	"while",
	"until",
	"!",
	"command",
	"exec",
]);

const IGNORED = new Set([
	// Keywords and control flow.
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"case",
	"esac",
	"for",
	"while",
	"until",
	"do",
	"done",
	"in",
	"function",
	"select",
	"time",
	"return",
	"break",
	"continue",
	"local",
	"declare",
	"typeset",
	"export",
	"readonly",
	"set",
	"unset",
	"shift",
	"trap",
	"source",
	"eval",
	"exec",
	"exit",
	"return",
	// Builtins.
	"[",
	"]",
	"[[",
	"]]",
	"test",
	"echo",
	"printf",
	"cd",
	"pwd",
	"read",
	"let",
	"true",
	"false",
	":",
	".",
	"command",
	"type",
	"which",
	"alias",
	"umask",
	"wait",
	"kill",
	"getopts",
	"hash",
	"help",
	"history",
	"jobs",
	"bg",
	"fg",
	// Runtimes: they run the hook, they are not what the hook needs.
	"bash",
	"sh",
	"zsh",
	"dash",
	"ksh",
	"fish",
	"node",
	"deno",
	"python",
	"python3",
	"perl",
	"ruby",
	"php",
	"osascript",
	"powershell",
	"pwsh",
	"env",
	"nohup",
	"nice",
	"timeout",
	"xargs",
	"stdbuf",
	"script",
	// The shell's own plumbing: a hook that pipes through these is not asking
	// for a tool hyper could install.
	"cat",
	"tee",
	"head",
	"tail",
	"sed",
	"awk",
	"tr",
	"sort",
	"wc",
	"date",
	"id",
	"whoami",
	"uname",
	"sleep",
	"dirname",
	"basename",
	"mktemp",
]);

/**
 * Words that run something else, and whose first path argument is that
 * something: `bash <script>` calls the script. `cd /x` does not — its argument
 * is a directory it changes to, and a scanner that reported `/x` as a missing
 * tool would be reporting the shell's plumbing as a gap.
 */
const RUNTIMES = new Set([
	"bash",
	"sh",
	"zsh",
	"dash",
	"ksh",
	"env",
	"node",
	"deno",
	"python",
	"python3",
	"perl",
	"ruby",
	"osascript",
	"pwsh",
	"powershell",
	"xargs",
	"nohup",
	"timeout",
	"script",
	"stdbuf",
	"nice",
	"watch",
]);

/** A path whose basename is one of these is a runtime being named, not a tool. */
const RUNTIME_BASENAMES = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"ksh",
	"node",
	"deno",
	"python",
	"python3",
	"perl",
	"ruby",
	"env",
]);

/**
 * Split a shell command the way a shell reads it.
 *
 * A quoted run stays one word (quotes removed, nothing inside expanded), and the
 * operators that end a command come back as the word `"\n"`, so a caller can
 * tell one command from the next. `)` is also retained as a marker so the
 * candidate reader can skip a `case` subject and its entire pattern list.
 */
export function splitWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let started = false;
	let quote: '"' | "'" | null = null;

	const end = (): void => {
		if (started) words.push(current);
		current = "";
		started = false;
	};
	const boundary = (times = 1): void => {
		end();
		for (let i = 0; i < times; i++) words.push("\n");
	};

	for (let i = 0; i < command.length; i++) {
		const char = command[i];

		if (quote !== null) {
			// A backslash escapes the next character inside double quotes, and is
			// literal inside single quotes — which is what `FOO="a\"b"` needs.
			if (char === quote) quote = null;
			else if (char === "\\" && quote === '"' && i + 1 < command.length) current += command[++i];
			else current += char;
			started = true;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			started = true;
			continue;
		}
		if (char === "\\" && i + 1 < command.length) {
			current += command[++i];
			started = true;
			continue;
		}
		if (char === "\n") {
			// A newline ends a command exactly like `;` does.
			boundary();
			continue;
		}
		if (char === " " || char === "\t" || char === "\r") {
			end();
			continue;
		}
		// Consume exactly one redirect operand, never the following command or
		// boundary. Attached arguments (`.>out`) still finish the preceding word.
		if (char === ">" || char === "<") {
			if (/^\d+$/.test(current)) {
				current = "";
				started = false;
			} else end();
			while (command[i + 1] === char) i++;
			if (command[i + 1] === "&" || command[i + 1] === "|") i++;
			i++;
			while (command[i] === " " || command[i] === "\t") i++;
			let operandQuote: string | null = null;
			for (; i < command.length; i++) {
				const c = command[i];
				if (operandQuote !== null) {
					if (c === operandQuote) operandQuote = null;
					else if (c === "\\" && operandQuote === '"') i++;
				} else if (c === "'" || c === '"') operandQuote = c;
				else if (c === "\\") i++;
				else if (/[\s|&;(){}<>]/.test(c)) break;
			}
			i--;
			continue;
		}
		// `${HOME}` is one word — there are no commands inside a parameter
		// expansion. `$(` and a backtick are the opposite: they run something, so
		// they open a new command and are read like any other boundary.
		if (char === "$" && command[i + 1] === "{") {
			started = true;
			current += "${";
			// i is on the `$`; step past both it and the `{` the loop below reads.
			i += 2;
			let depth = 1;
			while (i < command.length && depth > 0) {
				const inner = command[i];
				if (inner === "{") depth++;
				else if (inner === "}") depth--;
				current += inner;
				i++;
			}
			i--;
			continue;
		}
		if (char === "$" && command[i + 1] === "(") {
			i++;
			boundary();
			continue;
		}
		if (char === "`") {
			boundary();
			continue;
		}
		// Operators that end a command. A lone `&` (background) counts too, which
		// is why this is a character set rather than a list of two-character pairs.
		if (
			char === "|" ||
			char === "&" ||
			char === ";" ||
			char === "(" ||
			char === "{" ||
			char === "}"
		) {
			boundary();
			continue;
		}
		if (char === ")") {
			// Keep the delimiter for the candidate reader's case-pattern handling.
			boundary();
			words.push(")", "\n");
			continue;
		}
		current += char;
		started = true;
	}
	end();
	return words;
}

/** One candidate: the first word of one command in one hook file. */
export interface Candidate {
	word: string;
	/** The command it came from, for the report. */
	command: string;
}

/** Could this word be a hook calling something? Anything else is a flag or a setting. */
function isInteresting(word: string): boolean {
	return (
		word.startsWith("/") ||
		word.startsWith("$") ||
		word === "~" ||
		word.startsWith("~/") ||
		IGNORED.has(word) ||
		findTool(word) !== undefined
	);
}

/**
 * The first word of every command in a hook command line.
 *
 * Leading `env` and `VAR=value` are peeled off first, and an assignment's value
 * contributes its first word too — that is where the operator's `bun` lives
 * (`TEMPAD_BIN="bun /…/cli.ts" bash /…/w5-stop.sh`). After the command word, a
 * runtime's first path argument is a candidate as well: `bash <script>` runs the
 * script, which is how `herdr-agent-state.sh` is seen at all.
 */
export function candidateWords(command: string): Candidate[] {
	const out: Candidate[] = [];
	let words = splitWords(command);
	while (words.length > 0) {
		if (words[0] === "\n" || words[0] === ")") {
			words = words.slice(1);
			continue;
		}
		while (words.length > 0) {
			const first = words[0];
			if (first === "case") {
				// The subject and every alternative before ')' are syntax, not commands.
				const close = words.indexOf(")");
				words = close === -1 ? [] : words.slice(close + 1);
				continue;
			}
			if (first === "env" || TRANSPARENT.has(first) || first.startsWith("-")) {
				words = words.slice(1);
				continue;
			}
			if (first.startsWith(">")) {
				words = words.slice(1);
				continue;
			}
			const eq = first.indexOf("=");
			if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(first.slice(0, eq))) {
				// The name is a variable, not a command. The value's first word is a
				// candidate when it is something a hook could be calling — `FOO=1`
				// and `LANG=C` are settings, and treating them as unknown tools
				// would bury the real answer under every variable a hook sets.
				const head = splitWords(first.slice(eq + 1))[0];
				if (head !== undefined && isInteresting(head)) out.push({ word: head, command });
				words = words.slice(1);
				continue;
			}
			break;
		}
		if (words.length === 0) break;
		if (words[0] !== "\n") {
			out.push({ word: words[0], command });
			if (RUNTIMES.has(words[0])) {
				for (let i = 1; i < words.length; i++) {
					if (words[i] === "\n") break;
					if (words[i].startsWith("/") || words[i].startsWith("~/")) {
						out.push({ word: words[i], command });
						break;
					}
				}
			}
		}
		while (words.length > 0 && words[0] !== "\n") words = words.slice(1);
	}
	return out;
}

/**
 * The tool a hook script's *name* implies.
 *
 * Only the first segment of the basename, and only an id of three characters or
 * more: `rtk-rewrite.sh` means `rtk`, `block-schedulewakeup.sh` means nothing
 * (`block` is two characters and `schedulewakeup` is not a tool), and
 * `fd-extra.sh` would otherwise mean `fd` for any file that starts with it.
 * An exact stem match counts too, for a script named just `wt`.
 */
function toolFromScriptName(path: string): string | undefined {
	const stem = basename(path).replace(/\.(sh|bash|js|mjs|ts|py)$/, "");
	const exact = findTool(stem);
	if (exact !== undefined) return exact.id;
	const first = stem.split(/[-_.]/)[0];
	if (first.length < 3) return undefined;
	return findTool(first)?.id;
}

/** The three buckets, sorted, from a set of candidates. */
export interface Classified {
	preselect: string[];
	unknown: string[];
	resolvesAfterClone: string[];
	configSync: string[];
}

/**
 * Sort candidates into their buckets.
 *
 * `home` is the user's home directory, which is what makes "a path in your
 * home" answerable at all.
 */
export function classify(candidates: readonly Candidate[], home: string): Classified {
	const preselect = new Set<string>();
	const unknown = new Set<string>();
	const afterClone = new Set<string>();
	const configSync = new Set<string>();

	for (const { word } of candidates) {
		if (word === "" || IGNORED.has(word)) continue;
		if (word.startsWith(">")) continue;
		// A glob is a `case` pattern, not a command: `*&*`, `cygwin*`, `*)*`.
		if (word.includes("*") || word.includes("?")) continue;
		// A path the plugin or the tool expands itself
		// (`${CLAUDE_PLUGIN_ROOT}/hooks/wt.sh`) ships with the plugin: hyper can't
		// install it and shouldn't call it missing. `${HOME-}` is the shell's own
		// "if HOME is unset" idiom and names the home, so it is not skipped.
		if (word.startsWith("$") && !/^\$\{?HOME-?\}?(?=\/|$)/.test(word)) continue;

		// `~` and `$HOME` are not expanded — this is not a shell — but they name the
		// user's home, and a hook written that way is a home path.
		const path = word.replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME-?\}?(?=\/|$)/, home);

		if (findTool(word) !== undefined) {
			preselect.add(word);
			continue;
		}
		if (path.startsWith("/")) {
			// A named runtime is not a tool we are missing.
			if (RUNTIME_BASENAMES.has(basename(path))) continue;
			// Only in the user's own hooks directory: a hook named after a tool
			// is a hook *for* that tool, and `.orca/agent-hooks/claude-hook.sh`
			// belongs to another agent's harness, not to the claude CLI.
			const named = path.startsWith(`${join(home, ".claude", "hooks")}/`)
				? toolFromScriptName(path)
				: undefined;
			// A hook named after a tool still says the path matters: it is listed in
			// its own bucket as well as preselecting the tool.
			if (named !== undefined) preselect.add(named);
			if (path.startsWith(`${join(home, ".claude", "hooks")}/`)) configSync.add(path);
			else if (home !== "" && path.startsWith(`${home}/`)) afterClone.add(path);
			else unknown.add(word);
			continue;
		}
		unknown.add(word);
	}

	const sorted = (set: Set<string>): string[] => [...set].sort();
	return {
		preselect: sorted(preselect),
		unknown: sorted(unknown),
		resolvesAfterClone: sorted(afterClone),
		configSync: sorted(configSync),
	};
}

/** The hook commands in any Claude JSON file, whatever its shape. */
export function commandsFrom(json: unknown): string[] {
	if (typeof json !== "object" || json === null) return [];
	const hooks = (json as { hooks?: unknown }).hooks;
	if (typeof hooks !== "object" || hooks === null) return [];
	const out: string[] = [];
	for (const entries of Object.values(hooks as Record<string, unknown>)) {
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (typeof entry !== "object" || entry === null) continue;
			const list = (entry as { hooks?: unknown }).hooks;
			if (!Array.isArray(list)) continue;
			for (const hook of list) {
				if (typeof hook !== "object" || hook === null) continue;
				const command = (hook as { command?: unknown }).command;
				if (typeof command === "string" && command.trim() !== "") out.push(command);
			}
		}
	}
	return out;
}

/** Read one JSON file, or null with the reason it could not be read. */
async function readJson(file: string, warnings: string[]): Promise<Record<string, unknown> | null> {
	try {
		return JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
	} catch (err) {
		warnings.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

/** Plugin names enabled in a settings file, as `<plugin>@<marketplace>`. */
export function enabledPlugins(settings: Record<string, unknown>): Set<string> | null {
	const raw = settings.enabledPlugins;
	if (raw === undefined) return null;
	if (Array.isArray(raw)) {
		return new Set(raw.filter((name): name is string => typeof name === "string"));
	}
	if (typeof raw !== "object" || raw === null) return null;
	// `{ "name@market": true }` — a plugin switched off is not one we read hooks for.
	return new Set(
		Object.entries(raw as Record<string, unknown>)
			.filter(([, on]) => on !== false)
			.map(([name]) => name),
	);
}

/**
 * The hook files of the plugins that are actually installed and switched on.
 *
 * Walking `plugins/` for every `hooks.json` reads all of them: every version of
 * a plugin ever installed, every marketplace's examples, other agents' hook
 * directories — 28 files on the operator's home, of which 4 are live. The
 * registry that Claude Code maintains (`plugins/installed_plugins.json`) says
 * which are installed, and `enabledPlugins` in the settings says which are on.
 */
export async function pluginHookFiles(
	claudeHome: string,
	enabled: Set<string> | null,
	warnings: string[],
): Promise<string[]> {
	const registry = join(claudeHome, "plugins", "installed_plugins.json");
	const json = await readJson(registry, warnings);
	const installed = json?.plugins;
	if (typeof installed !== "object" || installed === null) {
		warnings.push(`${registry}: no plugin list; only the settings files were read`);
		return [];
	}
	const files: string[] = [];
	for (const [name, entries] of Object.entries(installed as Record<string, unknown>)) {
		if (enabled !== null && !enabled.has(name)) continue;
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (typeof entry !== "object" || entry === null) continue;
			const raw = (entry as { installPath?: unknown }).installPath;
			if (typeof raw !== "string" || raw === "") continue;
			let dir = raw;
			try {
				// A marketplace can be a symlink; read what it points at.
				dir = await realpath(raw);
				if (!(await stat(dir)).isDirectory()) continue;
			} catch (err) {
				warnings.push(`${raw}: ${err instanceof Error ? err.message : String(err)}`);
				continue;
			}
			const hooksJson = join(dir, "hooks", "hooks.json");
			if (await exists(hooksJson)) files.push(hooksJson);
			// A plugin can carry its hooks inline in its manifest instead.
			const manifest = join(dir, ".claude-plugin", "plugin.json");
			if (await exists(manifest)) files.push(manifest);
		}
	}
	return files;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read the user's Claude config and work out which tools their hooks need.
 *
 * Missing files are normal — a machine that has never run Claude Code has no
 * settings.json — so they are skipped. Files that exist but cannot be read are
 * listed in `warnings`: silently scanning half a config would be a lie about
 * what was seen.
 */
export async function scanHooks(claudeHome: string, home?: string): Promise<HookScan> {
	const resolvedHome = home ?? homedir();
	const warnings: string[] = [];
	const files: string[] = [];
	const candidates: Candidate[] = [];

	const settingsFiles = [
		join(claudeHome, "settings.json"),
		join(claudeHome, "settings.local.json"),
	];
	let enabled: Set<string> | null = null;
	for (const file of settingsFiles) {
		const json = await readJson(file, warnings);
		if (json === null) continue;
		files.push(file);
		for (const command of commandsFrom(json)) candidates.push(...candidateWords(command));
		const here = enabledPlugins(json);
		if (here !== null) enabled = enabled === null ? here : new Set([...enabled, ...here]);
	}

	for (const file of await pluginHookFiles(claudeHome, enabled, warnings)) {
		const json = await readJson(file, warnings);
		if (json === null) continue;
		files.push(file);
		for (const command of commandsFrom(json)) candidates.push(...candidateWords(command));
	}

	return { ...classify(candidates, resolvedHome), files, warnings };
}
