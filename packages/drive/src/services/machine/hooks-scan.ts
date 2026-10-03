/**
 * What the user's Claude Code hooks need on a machine.
 *
 * A user's `settings.json` is the best evidence of which CLIs their agent work
 * actually depends on: the hooks call `bd`, `rtk`, `jq` and `bun` by name, and
 * nothing else on the machine records that. So setup reads those files — the
 * settings, the local overrides, and every installed plugin's `hooks/hooks.json`
 * — and preselects what they mention.
 *
 * Three buckets, because the three mean different things to the user:
 *
 * - `preselect` — a tool in the registry. `rtk-rewrite.sh` means `rtk` is
 *   needed, even though the first word of that command is a path.
 * - `resolvesAfterClone` — an absolute path inside the user's home that isn't a
 *   hook of ours (tempad's `w5-stop.sh`, for one). The file exists once the
 *   space is cloned there; it is not something setup can install, and calling it
 *   missing would be wrong.
 * - `unknown` — a bare word that is neither. The user decides; setup says what
 *   it saw and nothing more.
 *
 * Everything here is read-only. The files are the user's, and setup never edits
 * a Claude config (C-6 is about root, but the same discipline applies).
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { findTool } from "./tools.js";

/** What a scan found. */
export interface HookScan {
	/** Registry ids the hooks imply. */
	preselect: string[];
	/** Bare words that aren't in the registry. */
	unknown: string[];
	/** Absolute paths under the user's home that will exist after a clone. */
	resolvesAfterClone: string[];
	/** The files that were read, for the report and for debugging a wrong scan. */
	files: string[];
}

/**
 * Shell words we never treat as a missing tool: the shell's own words, plus the
 * runtimes. `bash`/`sh` run the hook and tell us nothing; `node` is not in the
 * registry and a user who runs a Node hook on every event already has it;
 * `bun` is in the registry and does get preselected.
 */
const IGNORED = new Set([
	"bash",
	"sh",
	"zsh",
	"dash",
	"node",
	"python",
	"python3",
	"perl",
	"ruby",
	"eval",
	"exec",
	"source",
	".",
	":",
	"true",
	"false",
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"for",
	"while",
	"do",
	"done",
	"case",
	"esac",
	"in",
	"function",
	"return",
	"local",
	"export",
	"read",
	"echo",
	"printf",
	"cat",
	"command",
	"type",
	"which",
	"set",
	"unset",
	"test",
	"[",
	"[[",
	"]]",
	"exec",
	"env",
	"nohup",
	"timeout",
]);

/**
 * Split a shell command into words the way a shell does: a quoted run stays one
 * word, with the quotes removed and nothing inside it expanded. `&&`, `||`, `;`
 * and a lone `&` come back as the word `"\n"`, so a caller can tell one command
 * from the next.
 */
export function splitWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let started = false;
	let quote: '"' | "'" | null = null;
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote !== null) {
			if (char === quote) {
				quote = null;
				// `started` is deliberately not reset: `TEMPAD_BIN="bun /x/cli.ts"`
				// is ONE shell word, and losing the distinction is how the second
				// word of a value starts looking like the next command.
			} else if (char !== "\\") {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			started = true;
			continue;
		}
		if (char === "\\" && i + 1 < command.length) {
			current += command[i + 1];
			i++;
			started = true;
			continue;
		}
		if (char === " " || char === "\t" || char === "\n") {
			if (started) words.push(current);
			current = "";
			started = false;
			continue;
		}
		// `&&`, `||`, `;` and `|` end a command; a lone `&` and a redirection
		// don't, and neither needs to be understood to find the first word.
		if (
			(char === "&" || char === "|" || char === ";") &&
			(command[i + 1] === char || char === ";")
		) {
			if (char !== ";" || command[i + 1] !== ";") i++;
			if (started) words.push(current);
			current = "";
			started = false;
			words.push("\n");
			continue;
		}
		current += char;
		started = true;
	}
	if (started) words.push(current);
	return words;
}

/**
 * The commands a hook file runs, whatever shape the file is in.
 *
 * Claude Code's schema is `{hooks: {<event>: [{matcher?, hooks: [{command}]}]}}`,
 * and both settings files and plugin files use it. Anything that doesn't match
 * contributes nothing: a hook file we can't read the shape of is a file to ask
 * about, not a file to fail setup over.
 */
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

/**
 * The tool a hook script's *name* implies: `rtk-rewrite.sh` → `rtk`,
 * `herdr-agent-state.sh` → `herdr`, `w5-stop.sh` → nothing.
 *
 * This is why the scan can see `rtk` and `herdr` at all: the operator's hooks for
 * both are shell scripts under `~/.claude/hooks`, so no hook command has `rtk`
 * or `herdr` as its first word. A script named after a tool is that tool's hook.
 */
function toolFromScriptName(path: string): string | undefined {
	const stem = basename(path).replace(/\.(sh|bash|js|mjs|ts|py)$/, "");
	for (const part of stem.split(/[-_.]/)) {
		if (findTool(part) !== undefined) return part;
	}
	return undefined;
}

/** One candidate: the first word of one command in one hook file. */
export interface Candidate {
	word: string;
	/** The command it came from, for the report. */
	command: string;
}

/**
 * Every first word in a command line.
 *
 * A hook command is a shell fragment, not one command: the operator's are
 * `TEMPAD_BIN="bun /…/cli.ts" bash /…/w5-stop.sh` and
 * `[ -n "$X" ] && [ -x "$X/notify.sh" ] && "$X/notify.sh" || true`. Taking the
 * first word of the whole line would find `bash` and stop, which is exactly the
 * tool the user has least trouble with. So the line is split on its shell
 * operators, each piece has its leading `env` and `VAR=value` assignments
 * stripped, and the first word of what remains is a candidate — including the
 * first word of an assignment's *value*, which is where `bun` actually lives.
 */
export function candidateWords(command: string): Candidate[] {
	const out: Candidate[] = [];
	// splitWords already reduced the line to words, with "\n" standing in for
	// every shell operator that ended a command.
	let words = splitWords(command);
	while (words.length > 0) {
		if (words[0] === "\n") {
			words = words.slice(1);
			continue;
		}
		// Leading assignments, and a leading `env`, carry no invocation of their own.
		while (words.length > 0) {
			const first = words[0];
			if (first === "env") {
				words = words.slice(1);
				continue;
			}
			const eq = first.indexOf("=");
			if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(first.slice(0, eq))) {
				// `TEMPAD_BIN=bun` is one word whose value is what runs; the *name* is
				// a variable, not a command. Only the value's first word is a
				// candidate, and only when it is something a hook could be calling —
				// `FOO=1` and `LANG=C` are settings, not tools, and treating them as
				// unknown tools would bury the real answer under every variable a
				// hook command sets.
				const head = splitWords(first.slice(eq + 1))[0];
				if (head !== undefined && isInteresting(head)) out.push({ word: head, command });
				words = words.slice(1);
				continue;
			}
			break;
		}
		if (words.length === 0) break;
		if (words[0] !== "\n") out.push({ word: words[0], command });
		// `bash /path/to/hook.sh` calls the script, so the script is a candidate
		// too — that is how `herdr-agent-state.sh` shows up when the command is
		// `bash '<that path>'`. Arguments of anything else (`jq -r .x`) are flags
		// and data, not tools, so they are left alone.
		if (IGNORED.has(words[0])) {
			for (let i = 1; i < words.length; i++) {
				if (words[i] === "\n") break;
				if (words[i].startsWith("/")) {
					out.push({ word: words[i], command });
					break;
				}
			}
		}
		// The rest of this command is its arguments: the next candidate is the
		// first word of the *next* command.
		while (words.length > 0 && words[0] !== "\n") words = words.slice(1);
	}
	return out;
}

/** Could this word be a hook calling something? Anything else is a variable or a flag. */
function isInteresting(word: string): boolean {
	return (
		word.startsWith("/") ||
		word.startsWith("$") ||
		IGNORED.has(word) ||
		findTool(word) !== undefined
	);
}

/**
 * Sort a set of words into the three buckets.
 *
 * `home` is the user's home directory (the parent of the Claude home), which is
 * what makes "absolute path under your home" answerable at all.
 */
export function classify(
	candidates: readonly Candidate[],
	home: string,
): { preselect: string[]; unknown: string[]; resolvesAfterClone: string[] } {
	const preselect = new Set<string>();
	const unknown = new Set<string>();
	const afterClone = new Set<string>();

	for (const { word } of candidates) {
		if (word === "") continue;
		// A path the plugin expands itself (`${CLAUDE_PLUGIN_ROOT}/hooks/wt.sh`)
		// ships with the plugin: hyper can't install it and shouldn't say it's
		// missing.
		if (word.startsWith("$")) continue;
		if (IGNORED.has(word)) continue;
		if (findTool(word) !== undefined) {
			preselect.add(word);
			continue;
		}
		if (word.startsWith("/")) {
			const named = toolFromScriptName(word);
			if (named !== undefined) {
				preselect.add(named);
				continue;
			}
			// Under the user's home: it is their own script and it will be there
			// once the space is cloned. Outside it, we have no idea whose it is.
			if (home !== "" && (word === home || word.startsWith(`${home}/`))) {
				afterClone.add(word);
				continue;
			}
			unknown.add(word);
			continue;
		}
		unknown.add(word);
	}

	return {
		preselect: [...preselect].sort(),
		unknown: [...unknown].sort(),
		resolvesAfterClone: [...afterClone].sort(),
	};
}

/** Every hook file under a Claude home: the two settings files and the plugins' `hooks.json`. */
async function hookFiles(claudeHome: string): Promise<string[]> {
	const files = [join(claudeHome, "settings.json"), join(claudeHome, "settings.local.json")];
	// Plugins are cached per marketplace/version, at whatever depth the marketplace
	// nests them, so the search is for the file name rather than a fixed path.
	// `.git` directories are skipped: a plugin repo's own hooks are not ours.
	const stack = [join(claudeHome, "plugins")];
	let scanned = 0;
	while (stack.length > 0 && scanned < 500) {
		const dir = stack.pop() as string;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue; // No plugins, or not readable. Neither is an error.
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === ".git" || entry.name === "node_modules") continue;
				stack.push(path);
				continue;
			}
			if (entry.name !== "hooks.json") continue;
			files.push(path);
			scanned++;
		}
	}
	return files;
}

/**
 * Read the user's Claude config and work out which tools their hooks need.
 *
 * Missing files are normal — a machine that has never run Claude Code has no
 * settings.json — so they are skipped, and the file list in the result says
 * what was actually read.
 */
export async function scanHooks(claudeHome: string, home?: string): Promise<HookScan> {
	const resolvedHome = home ?? join(claudeHome, "..");
	const files: string[] = [];
	const candidates: Candidate[] = [];
	for (const file of await hookFiles(claudeHome)) {
		let json: unknown;
		try {
			json = JSON.parse(await readFile(file, "utf-8"));
		} catch {
			continue;
		}
		const commands = commandsFrom(json);
		if (commands.length === 0) continue;
		files.push(file);
		for (const command of commands) candidates.push(...candidateWords(command));
	}
	const buckets = classify(candidates, resolvedHome);
	return { ...buckets, files };
}
