import { describe, expect, it } from "vitest";
import { pstack } from "../../src/content/sources";
import AgentRef from "../../src/tags/references/agent-ref.marko";
import BinaryRef from "../../src/tags/references/binary-ref.marko";
import CodeRef from "../../src/tags/references/code-ref.marko";
import CommandRef from "../../src/tags/references/command-ref.marko";
import FileRef from "../../src/tags/references/file-ref.marko";
import HookRef from "../../src/tags/references/hook-ref.marko";
import PlaybookRef from "../../src/tags/references/playbook-ref.marko";
import ScriptRef from "../../src/tags/references/script-ref.marko";
import SkillRef from "../../src/tags/references/skill-ref.marko";
import SourceLink from "../../src/tags/references/source-link.marko";
import ToolRef from "../../src/tags/references/tool-ref.marko";
import Quote from "./fixtures/quote.marko";

type Tag = { render(input: object): { toString(): string } };

const render = (tag: unknown, input: object): string => (tag as Tag).render(input).toString();
const text = (html: string): string =>
	html
		.replace(/<svg[\s\S]*?<\/svg>/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
// Marko leaves attribute values unquoted when it can.
const hrefs = (html: string): string[] =>
	[...html.matchAll(/href=(?:"([^"]*)"|([^\s>]+))/g)].map((m) => m[1] ?? m[2]);
const attr = (html: string, name: string): string | undefined => {
	const m = new RegExp(`${name}(?:=(?:"([^"]*)"|([^\\s>]+)))?[\\s>]`).exec(html);
	return m ? (m[1] ?? m[2] ?? "") : undefined;
};
const linkTexts = (html: string): string[] =>
	[...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));

const FILE = "skills/poteto-mode/SKILL.md";
const BLOB = `${pstack.repo}/blob/${pstack.commit}/${pstack.prefix}${FILE}`;
const PATH_WITH_LINE = /[\w.-]+\/[\w./-]+:\d+/;

describe("source-link slot variant", () => {
	const base = { of: pstack, kind: "skill", name: "poteto-mode", path: FILE, variant: "slot" };

	it("shows :<n> and targets the naming file at that line", () => {
		const html = render(SourceLink, { ...base, line: "20" });
		expect(text(html)).toBe(":20");
		expect(hrefs(html)).toEqual([`${BLOB}?plain=1#L20`]);
		expect(attr(html, "data-slot")).toBe("");
	});

	it("gives one link per part, and :a-b for a range", () => {
		const html = render(SourceLink, { ...base, line: "12-14,30" });
		expect(linkTexts(html)).toEqual([":12-14", ":30"]);
		expect(hrefs(html)).toEqual([`${BLOB}?plain=1#L12-L14`, `${BLOB}?plain=1#L30`]);
	});
});

describe("reference tags, prose variant", () => {
	// [tag, kind, name, expected text, has an icon, shown as code]
	const cases: [string, unknown, string, string, boolean][] = [
		["skill-ref", SkillRef, "ulw-execute", "/ulw-execute", false],
		["skill-ref with a slash", SkillRef, "/loop", "/loop", false],
		["command-ref", CommandRef, "deslop", "/deslop", false],
		["agent-ref", AgentRef, "reviewer", "reviewer", true],
		["hook-ref", HookRef, "claim-receipt", "claim-receipt", true],
		["file-ref", FileRef, "AGENTS.md", "AGENTS.md", true],
		["playbook-ref", PlaybookRef, "bug-fix.md", "bug-fix.md", true],
		["script-ref", ScriptRef, "check.sh", "check.sh", true],
		["code-ref", CodeRef, "index.ts", "index.ts", true],
		["binary-ref", BinaryRef, "git", "git", true],
	];

	it.each(cases)(
		"%s shows its name, keeps the line in the target only",
		(_n, tag, name, shown, icon) => {
			const html = render(tag, { of: pstack, name, path: FILE, line: "150-162" });
			expect(text(html)).toBe(shown);
			expect(html.includes("kind-icon")).toBe(icon);
			expect(html.includes("<code>")).toBe(!icon);
			expect(hrefs(html)).toEqual([`${BLOB}?plain=1#L150-L162`]);
			for (const t of linkTexts(html)) expect(t).not.toMatch(PATH_WITH_LINE);
		},
	);

	it("a comma spec links the first part on the name and each further part as :<n>", () => {
		const html = render(SkillRef, { of: pstack, name: "plan", path: FILE, line: "3,7-9" });
		expect(hrefs(html)).toEqual([`${BLOB}?plain=1#L3`, `${BLOB}?plain=1#L7-L9`]);
		expect(linkTexts(html)).toEqual(["/plan", ":7-9"]);
		// Each part is in exactly one data-lines; only the extra link is marked data-more.
		expect([...html.matchAll(/data-lines=([^\s>]+)/g)].map((m) => m[1])).toEqual(["3", "7-9"]);
		expect(html.match(/data-more/g)).toHaveLength(1);
		expect(html).not.toContain("data-slot");
	});

	it("the name variant shows icon and name even for a skill", () => {
		const html = render(SourceLink, {
			of: pstack,
			kind: "skill",
			name: "poteto-mode",
			path: FILE,
			variant: "name",
		});
		expect(text(html)).toBe("poteto-mode");
		expect(html).toContain("kind-icon");
	});

	it("a reference with no path renders the same text and no link", () => {
		for (const [tag, shown] of [
			[FileRef, "AGENTS.md"],
			[SkillRef, "/AGENTS.md"],
		] as const) {
			const html = render(tag, { of: pstack, name: "AGENTS.md" });
			expect(text(html)).toBe(shown);
			expect(html).not.toContain("<a ");
			expect(html).not.toContain("href");
		}
	});
});

describe("tags without a file behind them", () => {
	it("tool-ref is icon and name and never a link", () => {
		const html = render(ToolRef, { name: "Bash" });
		expect(text(html)).toBe("Bash");
		expect(html).toContain("kind-icon");
		expect(html).not.toContain("href");
	});

	it("cited-quote is its body in q, followed by a prose source link", () => {
		const html = render(Quote, {});
		expect(html).toMatch(/<q[^>]*>the quote<\/q>\s*<a /);
		expect(linkTexts(html)).toEqual(["SKILL.md"]);
		expect(hrefs(html)).toEqual([`${BLOB}?plain=1#L20`]);
	});
});

describe("source-link HTML hooks", () => {
	it("carries data-ref, data-source, data-path and data-lines", () => {
		const html = render(SourceLink, {
			of: pstack,
			kind: "agent",
			name: "x",
			path: FILE,
			line: "7",
		});
		expect(attr(html, "data-ref")).toBe("agent");
		expect(attr(html, "data-source")).toBe("pstack");
		expect(attr(html, "data-path")).toBe(FILE);
		expect(attr(html, "data-lines")).toBe("7");
		expect(attr(html, "data-slot")).toBeUndefined();
	});
});
