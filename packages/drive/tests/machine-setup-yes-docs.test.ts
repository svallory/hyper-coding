/**
 * `hyper machine setup --yes` is described in four places: the flag's help,
 * the comment on `canAskAboutRoot`, the sudo paragraph of the drive README and
 * the Machines paragraph of the hyper skill. They drifted apart once (the help
 * promised no root while the code still offered "Run it for me"). This pins
 * all four to the behaviour: `--yes` asks nothing about root, even in a
 * terminal, and exits `PENDING_ROOT_EXIT` (3) with root steps pending.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Setup, {
	canAskAboutRoot,
	exitCodeFor,
	PENDING_ROOT_EXIT,
	rootPrompt,
} from "#commands/machine/setup";

const repository = join(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repository, ...parts), "utf8");
/** Prose is wrapped and indented differently in each file: compare it flat. */
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The paragraph of `text` that starts with `start`, up to the next blank line. */
function paragraph(text: string, start: string): string {
	const at = text.indexOf(start);
	expect(at, `no paragraph starting with ${JSON.stringify(start)}`).toBeGreaterThanOrEqual(0);
	const end = text.indexOf("\n\n", at);
	return flat(text.slice(at, end === -1 ? undefined : end));
}

/** What every description of `--yes` must say, in its own words. */
function expectYesContract(text: string, where: string): void {
	expect(text, `${where}: --yes asks nothing about root`).toMatch(
		/asks nothing about root even in a terminal/,
	);
	expect(text, `${where}: --yes leaves the script`).toMatch(
		/(leaves the printed script for you|writes the script)/,
	);
	expect(text, `${where}: --yes exits ${PENDING_ROOT_EXIT}`).toContain(
		`exits ${PENDING_ROOT_EXIT} when root steps are pending`,
	);
}

describe("machine setup --yes: help, comment and docs match the behaviour", () => {
	it("the behaviour: with --yes on a terminal the root question is not asked, and pending root work exits 3", async () => {
		expect(PENDING_ROOT_EXIT).toBe(3);
		expect(canAskAboutRoot(true, true)).toBe(false);
		const left: string[] = [];
		const answer = await rootPrompt(canAskAboutRoot(true, true), (path) =>
			left.push(path),
		).rootChoice({
			machine: "m",
			path: "/tmp/hyper-machine-root.sh",
			tasks: ["agent-user.create"],
		});
		expect(answer).toBe("skip");
		expect(left).toEqual(["/tmp/hyper-machine-root.sh"]);
		expect(exitCodeFor("/tmp/hyper-machine-root.sh")).toBe(PENDING_ROOT_EXIT);
	});

	it("the --yes help says it", () => {
		const help = flat(Setup.flags.yes.description ?? "");
		expect(help).toMatch(/^Take the defaults/);
		expect(help).toContain("Never runs anything as root");
		expect(help).toContain(`it asks nothing about root even in a terminal`);
		expect(help).toContain("leaves the printed script for you");
		expect(help).toContain(`exits ${PENDING_ROOT_EXIT} when root steps are pending`);
	});

	it("the comment on canAskAboutRoot says it", () => {
		const source = read("packages", "drive", "src", "commands", "machine", "setup.ts");
		const at = source.indexOf("export function canAskAboutRoot");
		const comment = flat(
			source.slice(source.lastIndexOf("/**", at), at).replace(/^\s*\*\/?\s?/gm, ""),
		);
		expect(comment).toContain("asks nothing about root");
		expect(comment).toContain(`exits ${PENDING_ROOT_EXIT} when root steps are pending`);
	});

	it("the drive README's sudo paragraph says it", () => {
		const text = paragraph(read("packages", "drive", "README.md"), "Setup is idempotent per task");
		expect(text).toContain("never runs sudo unless you choose it");
		expectYesContract(text, "README");
		expect(text).toContain("Skip there is a deliberate answer, so the run exits 0");
	});

	it("the hyper skill's Machines paragraph says it", () => {
		const text = paragraph(read("agent-plugin", "skills", "hyper", "SKILL.md"), "**Machines.**");
		expect(text).toContain("Hyper never runs sudo unless you pick it");
		expectYesContract(text, "SKILL.md");
		expect(text).toContain("Skip exits 0");
	});
});
