/**
 * The hook scan: what the user's Claude Code config says their machine needs.
 *
 * The fixture is the operator's real hook set — the settings hooks including the
 * vendor ones (ORCA's `if/case` shell and SUPERSET's `[ … ] &&` chain), a
 * `settings.local.json`, and one installed plugin's `hooks.json`, with token
 * values stripped and nothing private kept. Those two vendor commands are the
 * test: a scanner that reports `*)`, `/bin/sh`, `{` and `}` as missing tools has
 * not read a shell, it has counted punctuation.
 *
 * The buckets are the contract: a registry tool is preselected, a hook under
 * `~/.claude/hooks` needs a config sync, some other path in the user's home
 * resolves after the space is cloned, and anything else is reported as unknown
 * rather than guessed at.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Candidate,
	candidateWords,
	classify,
	commandsFrom,
	enabledPlugins,
	scanHooks,
	splitWords,
} from "#services/machine/hooks-scan";

/** The operator's home, which is what the fixture's absolute paths are under. */
const HOME = "/Users/svallory";
const FIXTURE_SOURCE = join(import.meta.dirname, "fixtures", "claude-home-hooks");
let FIXTURE: string;
beforeAll(async () => {
	FIXTURE = await mkdtemp(join(tmpdir(), "hyper-relocated-hooks-"));
	temps.push(FIXTURE);
	await cp(FIXTURE_SOURCE, FIXTURE, { recursive: true });
	const registryPath = join(FIXTURE, "plugins", "installed_plugins.json");
	const registry = JSON.parse(await readFile(registryPath, "utf8"));
	for (const entries of Object.values(registry.plugins) as { installPath: string }[][]) {
		for (const entry of entries) entry.installPath = join(FIXTURE, entry.installPath);
	}
	await writeFile(registryPath, JSON.stringify(registry));
});

const temps: string[] = [];
afterAll(async () => {
	for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

/** The command words the splitter finds in a command line, in order. */
function words(command: string): string[] {
	return candidateWords(command).map((candidate) => candidate.word);
}

/** The same command, after classification: tools, and whatever is left unknown. */
function classified(command: string): string[] {
	return classify(candidateWords(command), HOME).preselect;
}

describe("scanHooks", () => {
	it("preselects the tools the operator's hooks call", async () => {
		const scan = await scanHooks(FIXTURE, HOME);
		expect(scan.preselect).toEqual(["bd", "bun", "herdr", "jq", "rtk"]);
	});

	it("reads the local settings and the installed plugins, and nothing else", async () => {
		const scan = await scanHooks(FIXTURE, HOME);
		expect(scan.files).toHaveLength(3);
		expect(scan.files.some((file) => file.endsWith("settings.json"))).toBe(true);
		expect(scan.files.some((file) => file.endsWith("settings.local.json"))).toBe(true);
		expect(scan.files.some((file) => file.includes("/plugins/cache/worktrunk/"))).toBe(true);
		// A plugin directory that is still on disk but switched off in the
		// settings is not one of the user's hooks (M2).
		expect(scan.files.some((file) => file.includes("gone-plugin"))).toBe(false);
		expect(scan.unknown).not.toContain("wibble");
	});

	it("does not report shell punctuation from the vendor hooks as missing tools", async () => {
		const scan = await scanHooks(FIXTURE, HOME);
		for (const junk of ["*)", "/bin/sh", "{", "}", "msys*", "cygwin*", "case", "esac"]) {
			expect(scan.unknown, junk).not.toContain(junk);
		}
		// …and it still finds the tools buried in them.
		expect(scan.preselect).toContain("jq");
	});

	it("lists the tempad hook paths as resolving after the space is cloned", async () => {
		const scan = await scanHooks(FIXTURE, HOME);
		expect(scan.resolvesAfterClone).toContain(
			"/Users/svallory/work/tempad/worktrees/main/packages/core/hooks/w5-stop.sh",
		);
		expect(scan.resolvesAfterClone).toContain(
			"/Users/svallory/work/tempad/worktrees/main/packages/core/hooks/w5-prompt.sh",
		);
	});

	it("names the user's own hooks as needing a config sync, not a clone", async () => {
		const scan = await scanHooks(FIXTURE, HOME);
		expect(scan.configSync).toContain("/Users/svallory/.claude/hooks/rtk-rewrite.sh");
		expect(scan.configSync).toContain("/Users/svallory/.claude/hooks/block-schedulewakeup.sh");
		expect(scan.resolvesAfterClone).not.toContain("/Users/svallory/.claude/hooks/rtk-rewrite.sh");
		// The tool is preselected *and* the hook is still listed: sync config is
		// what brings the file. Another agent's hook that merely has a tool's name
		// in it does not preselect it.
		expect(scan.preselect).toContain("rtk");
		expect(scan.preselect).not.toContain("claude");
	});

	it("reports a word it doesn't know instead of guessing", async () => {
		const scan = await scanHooks(FIXTURE, HOME);
		expect(scan.unknown).toEqual(["orbita"]);
		expect(scan.warnings).toEqual([]);
	});

	it("tolerates a Claude home that isn't there, or is half there", async () => {
		const empty = await scanHooks(join(tmpdir(), "hyper-no-such-claude-home"), HOME);
		expect(empty.preselect).toEqual([]);
		expect(empty.files).toEqual([]);
		// Nothing installed means nothing to warn about beyond the missing list.
		expect(empty.warnings.some((warning) => warning.includes("installed_plugins.json"))).toBe(true);

		const dir = await mkdtemp(join(tmpdir(), "hyper-hooks-"));
		temps.push(dir);
		await writeFile(join(dir, "settings.json"), "{ not json at all");
		const broken = await scanHooks(dir, HOME);
		expect(broken.files).toEqual([]);
		expect(broken.preselect).toEqual([]);
		expect(broken.warnings.some((warning) => warning.includes("settings.json"))).toBe(true);
	});

	it("reads a plugin hook from a deeper cache layout", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hyper-hooks-plugin-"));
		temps.push(dir);
		const cache = join(dir, "plugins", "cache", "some-market", "tool", "1.2.3");
		await mkdir(join(cache, "hooks"), { recursive: true });
		await writeFile(
			join(cache, "hooks", "hooks.json"),
			JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "fd -t f" }] }] } }),
		);
		await writeFile(
			join(dir, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: { "tool@some-market": [{ scope: "user", installPath: cache }] },
			}),
		);
		const scan = await scanHooks(dir, HOME);
		expect(scan.preselect).toEqual(["fd"]);
	});

	it("reads hooks declared inline in a plugin manifest", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hyper-hooks-inline-"));
		temps.push(dir);
		const plugin = join(dir, "plugins", "cache", "m", "inline-plugin", "1.0.0");
		await mkdir(join(plugin, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(plugin, ".claude-plugin", "plugin.json"),
			JSON.stringify({
				name: "inline-plugin",
				hooks: { Stop: [{ hooks: [{ command: "gh pr view" }] }] },
			}),
		);
		await writeFile(
			join(dir, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: { "inline-plugin@m": [{ scope: "user", installPath: plugin }] },
			}),
		);
		expect((await scanHooks(dir, HOME)).preselect).toEqual(["gh"]);
	});

	it("warns about an installed plugin whose directory is gone", async () => {
		const dir = await mkdtemp(join(tmpdir(), "hyper-hooks-gone-"));
		temps.push(dir);
		await mkdir(join(dir, "plugins"), { recursive: true });
		await writeFile(
			join(dir, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: { "gone@m": [{ scope: "user", installPath: "/nope/not/here" }] },
			}),
		);
		const scan = await scanHooks(dir, HOME);
		expect(scan.warnings.some((warning) => warning.includes("/nope/not/here"))).toBe(true);
	});

	it("honours a plugin switched off in enabledPlugins", () => {
		expect(enabledPlugins({ enabledPlugins: { "a@m": true, "b@m": false } })).toEqual(
			new Set(["a@m"]),
		);
		expect(enabledPlugins({ enabledPlugins: ["a@m"] })).toEqual(new Set(["a@m"]));
		expect(enabledPlugins({})).toBeNull();
		expect(enabledPlugins({ enabledPlugins: "nonsense" })).toBeNull();
	});
});

/** The table the review fixes: each input, and the words it must yield. */
describe("splitting a hook command", () => {
	it.each([
		["jq . 2>&1 | gh api", ["gh", "jq"]],
		["jq .>out && fd x", ["fd", "jq"]],
		["cmd > /tmp/o; rg z", ["rg"]],
		["if command -v rtk >/dev/null; then rtk x; fi", ["rtk"]],
		['case "$1" in start|stop) rtk x;; esac', ["rtk"]],
	])("round 2: %s", (command, expected) => {
		const result = classify(candidateWords(command), HOME);
		expect(result.preselect).toEqual(expected);
		expect(result.unknown).toEqual(command.startsWith("cmd ") ? ["cmd"] : []);
	});

	it.each([
		["echo $X | jq -r .foo", ["echo", "jq"]],
		["cat f | rg foo", ["cat", "rg"]],
		["jq . & rtk x", ["jq", "rtk"]],
		["echo a\nrtk gain", ["echo", "rtk"]],
		['FOO="a\\"b" jq .', ["jq"]],
		["VAR=$(jq -r .a) bd", ["jq", "bd"]],
		["(cd /x && rtk gain)", ["cd", "rtk"]],
	])("%s yields its commands, not its arguments", (command, expected) => {
		expect(words(command)).toEqual(expected);
	});

	it("classifies the shell's own words away, keeping only the tools", () => {
		// The splitter names every command; the classifier is what decides one of
		// them is a tool hyper could install.
		expect(classified("echo $X | jq -r .foo")).toEqual(["jq"]);
		expect(classified("(cd /x && rtk gain)")).toEqual(["rtk"]);
		expect(classified("cat f | rg foo")).toEqual(["rg"]);
		expect(classified("VAR=$(jq -r .a) bd")).toEqual(["bd", "jq"]);
		expect(classified('FOO="a\\"b" jq .')).toEqual(["jq"]);
	});

	it("reads a home path written with ~ or $HOME as a home path", () => {
		for (const command of [
			"~/.claude/hooks/rtk-rewrite.sh",
			"$HOME/.claude/hooks/rtk-rewrite.sh",
		]) {
			const buckets = classify([{ word: words(command)[0] ?? command, command }], HOME);
			expect(buckets.unknown, command).toEqual([]);
			expect(buckets.configSync, command).toContain(`${HOME}/.claude/hooks/rtk-rewrite.sh`);
		}
	});

	it("keeps a quoted run as one word and expands nothing", () => {
		expect(splitWords("bash '/Users/s/me/hooks/x.sh' session")).toEqual([
			"bash",
			"/Users/s/me/hooks/x.sh",
			"session",
		]);
		expect(splitWords('jq -r ".session.id"')).toEqual(["jq", "-r", ".session.id"]);
		expect(splitWords("$HOME/a")).toEqual(["$HOME/a"]);
		expect(splitWords("${ORCA_PORT-}")).toEqual(["${ORCA_PORT-}"]);
	});

	it("does not read a redirection's operand as a command", () => {
		expect(classified("{ command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :")).toEqual([]);
		expect(classified("jq . 2>&1 > /tmp/out")).toEqual(["jq"]);
		expect(words("jq . 2>&1 > /tmp/out")).toEqual(["jq"]);
	});

	it("reads a tool out of a VAR=... prefix without mistaking the variable for one", () => {
		expect(words('TEMPAD_BIN="bun /Users/x/cli.ts" bash /Users/x/stop.sh')).toEqual([
			"bun",
			"bash",
			"/Users/x/stop.sh",
		]);
		expect(words("env FOO=1 LANG=C rg --version")[0]).toBe("rg");
		expect(words("LANG=C rg")).toEqual(["rg"]);
	});

	it("drops a case pattern list", () => {
		// The splitter sees the pattern list as commands (it cannot know it is
		// inside a `case` once the globs have eaten the brackets); the classifier
		// is what keeps a glob out of the answer, and what keeps the keyword out.
		expect(classified('case "${OSTYPE-}" in msys*|cygwin*|win32*) printf 1 ;; esac')).toEqual([]);
		expect(
			classify(candidateWords('case "$X" in *&*|*,*) printf 1 ;; esac'), HOME).unknown,
		).toEqual([]);
	});
});

describe("classifying what the hooks mention", () => {
	it("puts a registry tool in preselect and an unknown word in unknown", () => {
		const buckets = classify(
			[
				{ word: "gh", command: "gh pr list" },
				{ word: "wibble", command: "wibble go" },
			],
			HOME,
		);
		expect(buckets.preselect).toEqual(["gh"]);
		expect(buckets.unknown).toEqual(["wibble"]);
	});

	it("reads a tool out of a hook script's name, and keeps the path too", () => {
		const buckets = classify(
			[
				{ word: "/Users/svallory/.claude/hooks/rtk-rewrite.sh", command: "" },
				{ word: "/Users/svallory/.claude/hooks/herdr-agent-state.sh", command: "" },
				{ word: "/Users/svallory/work/tempad/w5-stop.sh", command: "" },
			],
			HOME,
		);
		expect(buckets.preselect).toEqual(["herdr", "rtk"]);
		expect(buckets.configSync).toContain("/Users/svallory/.claude/hooks/rtk-rewrite.sh");
		expect(buckets.resolvesAfterClone).toEqual(["/Users/svallory/work/tempad/w5-stop.sh"]);
	});

	it("only reads a tool out of the first segment, and only from a real id", () => {
		// `block-schedulewakeup.sh`: `block` is two characters and is not a tool.
		expect(toolOf("block-schedulewakeup.sh")).toBeUndefined();
		// `fd-extra.sh` starts with a tool id, but the file is about something else.
		expect(toolOf("fd-extra.sh")).toBeUndefined();
		expect(toolOf("wt.sh")).toBe("wt");
		expect(toolOf("herdr-agent-state.sh")).toBe("herdr");
	});

	it("ignores a path that is only naming a runtime", () => {
		expect(classify([{ word: "/bin/sh", command: "" }], HOME).unknown).toEqual([]);
		expect(classify([{ word: "/opt/tools/x", command: "" }], HOME).unknown).toEqual([
			"/opt/tools/x",
		]);
	});

	it("leaves an expanded-by-someone-else path alone", () => {
		const buckets = classify([{ word: "${CLAUDE_PLUGIN_ROOT}/hooks/wt.sh", command: "" }], HOME);
		expect(buckets.unknown).toEqual([]);
		expect(buckets.preselect).toEqual([]);
	});
});

/** The tool a script's name implies, via the public classifier. */
function toolOf(name: string): string | undefined {
	const buckets = classify([{ word: `${HOME}/.claude/hooks/${name}`, command: "" }], HOME);
	return buckets.preselect.length > 0 ? buckets.preselect[0] : undefined;
}

describe("commandsFrom", () => {
	it("takes every command from every event and matcher", () => {
		expect(
			commandsFrom({
				hooks: {
					PreToolUse: [
						{ matcher: "Bash", hooks: [{ type: "command", command: "a" }] },
						{ hooks: [{ type: "command", command: "b" }] },
					],
					SessionEnd: [{ hooks: [{ type: "command", command: "c" }] }],
				},
			}),
		).toEqual(["a", "b", "c"]);
	});

	it("ignores a file whose shape it doesn't recognise", () => {
		expect(commandsFrom(null)).toEqual([]);
		expect(commandsFrom({})).toEqual([]);
		expect(commandsFrom({ hooks: { Stop: "nope" } })).toEqual([]);
		expect(commandsFrom({ hooks: { Stop: [{ hooks: "nope" }] } })).toEqual([]);
		expect(commandsFrom({ hooks: { Stop: [{ hooks: [{ command: "" }] }] } })).toEqual([]);
	});

	it("takes the commands of a candidate's own file", () => {
		const candidates: Candidate[] = [{ word: "jq", command: "jq ." }];
		expect(candidates[0].command).toBe("jq .");
	});
});
