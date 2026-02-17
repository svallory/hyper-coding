import { beforeEach, describe, expect, test } from "vitest";
import { columns } from "#components/columns";
import { diff } from "#components/diff";
import { helpLayout } from "#components/helpLayout";
import { keyValue } from "#components/keyValue";
import { list } from "#components/list";
import { message } from "#components/message";
import { panel } from "#components/panel";
import { section } from "#components/section";
import { statusList } from "#components/statusList";
import { table } from "#components/table";
import { tree } from "#components/tree";
import { createContext, setContext } from "#primitives/context";
import { stringWidth, stripAnsi } from "#render/index";

// ---------------------------------------------------------------------------
// Context fixtures
// ---------------------------------------------------------------------------

const fullCtx = createContext({
	colorDepth: "truecolor",
	unicode: true,
	isDumb: false,
	noColor: false,
	columns: 80,
});

const asciiCtx = createContext({
	colorDepth: "16",
	unicode: false,
	isDumb: false,
	noColor: false,
	columns: 80,
});

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

describe("message", () => {
	beforeEach(() => setContext(fullCtx));

	test("error level shows error symbol and styled text", () => {
		const result = message({ level: "error", text: "Something failed" });
		const plain = stripAnsi(result);
		expect(plain).toContain("\u2717"); // ✗
		expect(plain).toContain("Something failed");
	});

	test("success level shows success symbol", () => {
		const result = message({ level: "success", text: "Done" });
		const plain = stripAnsi(result);
		expect(plain).toContain("\u2713"); // ✓
		expect(plain).toContain("Done");
	});

	test("warning level shows warning symbol", () => {
		const result = message({ level: "warning", text: "Watch out" });
		const plain = stripAnsi(result);
		expect(plain).toContain("\u26A0"); // ⚠
	});

	test("info level shows info symbol", () => {
		const result = message({ level: "info", text: "FYI" });
		const plain = stripAnsi(result);
		expect(plain).toContain("\u2139"); // ℹ
	});

	test("details are indented", () => {
		const result = message({ level: "info", text: "Title", details: ["Detail 1", "Detail 2"] });
		const plain = stripAnsi(result);
		const lines = plain.split("\n");
		expect(lines[1]).toMatch(/^\s+Detail 1$/);
		expect(lines[2]).toMatch(/^\s+Detail 2$/);
	});

	test("hint is dimmed and indented", () => {
		const result = message({ level: "info", text: "Title", hint: "Try this" });
		const plain = stripAnsi(result);
		const lines = plain.split("\n");
		expect(lines[1]).toMatch(/^\s+Try this$/);
		// The ANSI version should contain dim styling
		expect(result).not.toBe(plain); // styled text present
	});

	test("details as string works", () => {
		const result = message({ level: "error", text: "Err", details: "One detail" });
		const plain = stripAnsi(result);
		expect(plain).toContain("One detail");
	});

	test("ASCII fallback uses ASCII symbols", () => {
		setContext(asciiCtx);
		const result = message({ level: "error", text: "Fail" });
		const plain = stripAnsi(result);
		expect(plain).toContain("[FAIL]");
	});
});

// ---------------------------------------------------------------------------
// statusList
// ---------------------------------------------------------------------------

describe("statusList", () => {
	beforeEach(() => setContext(fullCtx));

	test("each status maps to correct symbol", () => {
		const items = [
			{ text: "Build", status: "success" as const },
			{ text: "Test", status: "error" as const },
			{ text: "Lint", status: "warning" as const },
			{ text: "Deploy", status: "running" as const },
			{ text: "Verify", status: "pending" as const },
			{ text: "Docs", status: "skipped" as const },
		];
		const result = stripAnsi(statusList(items));
		expect(result).toContain("\u2713"); // success
		expect(result).toContain("\u2717"); // error
		expect(result).toContain("\u26A0"); // warning
		expect(result).toContain("\u25C9"); // running
		expect(result).toContain("\u25CC"); // pending
		expect(result).toContain("\u25CB"); // skipped
	});

	test("short detail shown inline", () => {
		const result = stripAnsi(statusList([{ text: "Build", status: "success", detail: "2.3s" }]));
		expect(result).toContain("Build");
		expect(result).toContain("(2.3s)");
	});

	test("long detail shown on next line", () => {
		const longDetail = "This is a very long detail that exceeds forty characters easily";
		const result = stripAnsi(
			statusList([{ text: "Build", status: "success", detail: longDetail }]),
		);
		const lines = result.split("\n");
		expect(lines.length).toBeGreaterThan(1);
		expect(lines[1]).toMatch(/^\s+/);
	});

	test("ASCII fallback", () => {
		setContext(asciiCtx);
		const result = stripAnsi(
			statusList([
				{ text: "Build", status: "success" },
				{ text: "Test", status: "error" },
			]),
		);
		expect(result).toContain("[OK]");
		expect(result).toContain("[FAIL]");
	});
});

// ---------------------------------------------------------------------------
// table
// ---------------------------------------------------------------------------

describe("table", () => {
	beforeEach(() => setContext(fullCtx));

	const sampleColumns = [
		{ key: "name", header: "Name" },
		{ key: "value", header: "Value", align: "right" as const },
	];
	const sampleData = [
		{ name: "alpha", value: "100" },
		{ name: "beta", value: "2000" },
	];

	test("minimal variant renders headers with divider", () => {
		const result = stripAnsi(table({ columns: sampleColumns, data: sampleData }));
		const lines = result.split("\n");
		expect(lines[0]).toContain("Name");
		expect(lines[0]).toContain("Value");
		// Second line is divider
		expect(lines[1]).toMatch(/[─\-]+/);
		// Data rows
		expect(lines[2]).toContain("alpha");
		expect(lines[3]).toContain("beta");
	});

	test("borderless variant has no divider", () => {
		const result = stripAnsi(
			table({ columns: sampleColumns, data: sampleData, variant: "borderless" }),
		);
		const lines = result.split("\n");
		expect(lines.length).toBe(3); // header + 2 data rows
		expect(lines[0]).toContain("Name");
		expect(lines[1]).toContain("alpha");
	});

	test("grid variant has borders around cells", () => {
		const result = stripAnsi(table({ columns: sampleColumns, data: sampleData, variant: "grid" }));
		// Should have vertical separators
		expect(result).toContain("\u2502"); // │
		// Should have corner chars
		expect(result).toContain("\u256D"); // ╭ (rounded top left)
	});

	test("outer variant has outer border only", () => {
		const result = stripAnsi(table({ columns: sampleColumns, data: sampleData, variant: "outer" }));
		expect(result).toContain("\u256D"); // top left
		expect(result).toContain("\u256F"); // bottom right
	});

	test("auto column widths from data", () => {
		const result = stripAnsi(table({ columns: sampleColumns, data: sampleData }));
		const lines = result.split("\n");
		// 'beta' is 4 chars, 'alpha' is 5 chars, so first column should be >= 5
		// The header 'Name' is also 4 chars, so width = max(5, 4) = 5
		expect(lines[2]).toContain("alpha");
	});

	test("empty data shows emptyText", () => {
		const result = table({ columns: sampleColumns, data: [], emptyText: "No data available" });
		expect(result).toBe("No data available");
	});

	test("empty data with no emptyText returns empty string", () => {
		const result = table({ columns: sampleColumns, data: [] });
		expect(result).toBe("");
	});

	test("truncation works with maxWidth", () => {
		const cols = [{ key: "name", header: "Name", maxWidth: 5, truncate: true }];
		const data = [{ name: "very-long-name-here" }];
		const result = stripAnsi(table({ columns: cols, data }));
		const lines = result.split("\n");
		// Data line should be truncated
		const dataLine = lines[2]!;
		expect(stringWidth(dataLine.trim())).toBeLessThanOrEqual(5);
	});

	test("right alignment works", () => {
		const result = stripAnsi(table({ columns: sampleColumns, data: sampleData }));
		const lines = result.split("\n");
		// Value column is right-aligned; "100" should be padded from the left
		// The value "100" should appear after spaces compared to "2000"
		expect(lines[2]).toContain(" 100");
	});

	test("ASCII fallback uses ASCII border chars", () => {
		setContext(asciiCtx);
		const result = stripAnsi(table({ columns: sampleColumns, data: sampleData, variant: "grid" }));
		expect(result).toContain("+");
		expect(result).toContain("|");
		expect(result).toContain("-");
	});
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("list", () => {
	beforeEach(() => setContext(fullCtx));

	test("unordered list with bullet style", () => {
		const result = stripAnsi(list(["Item 1", "Item 2", "Item 3"]));
		expect(result).toContain("\u2022"); // •
		expect(result).toContain("Item 1");
		expect(result).toContain("Item 2");
		expect(result).toContain("Item 3");
	});

	test("unordered list with dash style", () => {
		const result = stripAnsi(list(["Item 1"], { bulletStyle: "dash" }));
		expect(result).toContain("\u2500"); // ─
	});

	test("unordered list with arrow style", () => {
		const result = stripAnsi(list(["Item 1"], { bulletStyle: "arrow" }));
		expect(result).toContain("\u25B8"); // ▸
	});

	test("ordered list uses numbers", () => {
		const result = stripAnsi(list(["A", "B", "C"], { ordered: true }));
		expect(result).toContain("1.");
		expect(result).toContain("2.");
		expect(result).toContain("3.");
	});

	test("nested items are indented", () => {
		const items = [{ text: "Parent", children: ["Child 1", "Child 2"] }];
		const result = stripAnsi(list(items));
		const nonEmpty = result.split("\n").filter((l) => l.trim() !== "");
		expect(nonEmpty[0]).toMatch(/^[•\u2022]/); // parent at start
		expect(nonEmpty[1]).toMatch(/^\s+/); // child indented
	});

	test("nested ordered uses letters", () => {
		const items = [{ text: "Parent", children: ["Child A", "Child B"] }];
		const result = stripAnsi(list(items, { ordered: true }));
		expect(result).toContain("a.");
		expect(result).toContain("b.");
	});

	test("deeply nested items", () => {
		const items = [
			{
				text: "L1",
				children: [{ text: "L2", children: ["L3"] }],
			},
		];
		const result = stripAnsi(list(items));
		const nonEmpty = result.split("\n").filter((l) => l.trim() !== "");
		// Each level should have progressively more indentation
		const indent0 = nonEmpty[0]!.search(/\S/);
		const indent1 = nonEmpty[1]!.search(/\S/);
		const indent2 = nonEmpty[2]!.search(/\S/);
		expect(indent1).toBeGreaterThan(indent0);
		expect(indent2).toBeGreaterThan(indent1);
	});

	test("ASCII fallback uses ASCII bullet", () => {
		setContext(asciiCtx);
		const result = stripAnsi(list(["Item 1"]));
		expect(result).toContain("*");
	});
});

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

describe("tree", () => {
	beforeEach(() => setContext(fullCtx));

	const sampleTree: import("../../src/components/tree.ts").TreeNode = {
		label: "root",
		children: [{ label: "a", children: [{ label: "a1" }, { label: "a2" }] }, { label: "b" }],
	};

	test("renders root label", () => {
		const result = stripAnsi(tree(sampleTree));
		const lines = result.split("\n");
		expect(lines[0]).toBe("root");
	});

	test("uses branch and last connectors correctly", () => {
		const result = stripAnsi(tree(sampleTree));
		// 'a' is not last child -> branch connector (├──)
		expect(result).toContain("\u251C\u2500\u2500"); // ├──
		// 'b' is last child -> last connector (└──)
		expect(result).toContain("\u2514\u2500\u2500"); // └──
	});

	test("nested children have continuation lines", () => {
		const result = stripAnsi(tree(sampleTree));
		const lines = result.split("\n");
		// a's children should have vertical continuation from root level
		// lines: root, ├── a, │  ├── a1, │  └── a2, └── b
		expect(lines[2]).toContain("\u2502"); // │ vertical line for continuation
	});

	test("respects maxDepth", () => {
		const result = stripAnsi(tree(sampleTree, { maxDepth: 1 }));
		expect(result).toContain("a");
		expect(result).toContain("b");
		expect(result).not.toContain("a1");
		expect(result).not.toContain("a2");
	});

	test("showCounts appends child count", () => {
		const result = stripAnsi(tree(sampleTree, { showCounts: true }));
		expect(result).toContain("root (2)");
		expect(result).toContain("a (2)");
	});

	test("formatNode customizes label", () => {
		const result = stripAnsi(
			tree(sampleTree, {
				formatNode: (node) => `[${node.label}]`,
			}),
		);
		expect(result).toContain("[root]");
		expect(result).toContain("[a]");
	});

	test("ASCII fallback uses ASCII connectors", () => {
		setContext(asciiCtx);
		const result = stripAnsi(tree(sampleTree));
		expect(result).toContain("|--");
		expect(result).toContain("\\--");
	});

	test("leaf node renders without children", () => {
		const result = stripAnsi(tree({ label: "leaf" }));
		expect(result).toBe("leaf");
	});
});

// ---------------------------------------------------------------------------
// keyValue
// ---------------------------------------------------------------------------

describe("keyValue", () => {
	beforeEach(() => setContext(fullCtx));

	test("aligns keys and values", () => {
		const result = stripAnsi(
			keyValue([
				{ key: "Name", value: "Alice" },
				{ key: "Email Address", value: "alice@example.com" },
			]),
		);
		const lines = result.split("\n");
		// Both values should start at the same column
		const valStart0 = lines[0]!.indexOf("Alice");
		const valStart1 = lines[1]!.indexOf("alice@example.com");
		expect(valStart0).toBe(valStart1);
	});

	test("undefined values show null display", () => {
		const result = stripAnsi(keyValue([{ key: "Name", value: undefined }]));
		expect(result).toContain("-");
	});

	test("custom null display", () => {
		const result = stripAnsi(keyValue([{ key: "Name", value: undefined }], { nullDisplay: "N/A" }));
		expect(result).toContain("N/A");
	});

	test("custom separator", () => {
		const result = stripAnsi(keyValue([{ key: "Name", value: "Alice" }], { separator: " : " }));
		expect(result).toContain("Name : Alice");
	});

	test("keys are bold by default (ANSI present)", () => {
		const result = keyValue([{ key: "Name", value: "Alice" }]);
		// Bold ANSI code \x1b[1m should be present
		expect(result).toContain("\x1b[1m");
	});

	test("ASCII fallback works", () => {
		setContext(asciiCtx);
		const result = stripAnsi(keyValue([{ key: "Name", value: "Alice" }]));
		expect(result).toContain("Name");
		expect(result).toContain("Alice");
	});
});

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

describe("diff", () => {
	beforeEach(() => setContext(fullCtx));

	test("renders added lines with + prefix", () => {
		const result = stripAnsi(
			diff({
				hunks: [
					{
						header: "@@ -1,3 +1,4 @@",
						lines: [{ type: "add", content: "new line" }],
					},
				],
			}),
		);
		expect(result).toContain("+new line");
	});

	test("renders removed lines with - prefix", () => {
		const result = stripAnsi(
			diff({
				hunks: [
					{
						header: "@@ -1,3 +1,2 @@",
						lines: [{ type: "remove", content: "old line" }],
					},
				],
			}),
		);
		expect(result).toContain("-old line");
	});

	test("renders context lines with space prefix", () => {
		const result = stripAnsi(
			diff({
				hunks: [
					{
						header: "@@ -1,3 +1,3 @@",
						lines: [{ type: "context", content: "unchanged" }],
					},
				],
			}),
		);
		expect(result).toContain(" unchanged");
	});

	test("file header renders as divider", () => {
		const result = stripAnsi(
			diff({
				fileHeader: { old: "a.ts", new: "b.ts" },
				hunks: [
					{
						header: "@@ @@",
						lines: [],
					},
				],
			}),
		);
		expect(result).toContain("a.ts");
		expect(result).toContain("b.ts");
	});

	test("hunk header is present", () => {
		const result = stripAnsi(
			diff({
				hunks: [
					{
						header: "@@ -1,3 +1,4 @@",
						lines: [],
					},
				],
			}),
		);
		expect(result).toContain("@@ -1,3 +1,4 @@");
	});

	test("mixed add/remove/context", () => {
		const result = stripAnsi(
			diff({
				hunks: [
					{
						header: "@@ -1,3 +1,3 @@",
						lines: [
							{ type: "context", content: "same" },
							{ type: "remove", content: "old" },
							{ type: "add", content: "new" },
						],
					},
				],
			}),
		);
		const lines = result.split("\n");
		const contentLines = lines.filter((l) => !l.startsWith("@@"));
		expect(contentLines[0]).toBe(" same");
		expect(contentLines[1]).toBe("-old");
		expect(contentLines[2]).toBe("+new");
	});

	test("ASCII fallback works", () => {
		setContext(asciiCtx);
		const result = stripAnsi(
			diff({
				hunks: [
					{
						header: "@@ @@",
						lines: [
							{ type: "add", content: "added" },
							{ type: "remove", content: "removed" },
						],
					},
				],
			}),
		);
		expect(result).toContain("+added");
		expect(result).toContain("-removed");
	});
});

// ---------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------

describe("panel", () => {
	beforeEach(() => setContext(fullCtx));

	test("wraps content in border", () => {
		const result = stripAnsi(panel("Hello"));
		// Should have top and bottom border lines
		expect(result).toContain("\u256D"); // ╭
		expect(result).toContain("\u256F"); // ╯
		expect(result).toContain("Hello");
	});

	test("with title", () => {
		const result = stripAnsi(panel("Content", { title: "My Panel" }));
		expect(result).toContain("My Panel");
		expect(result).toContain("Content");
	});

	test("with padding adds vertical blank lines", () => {
		const result = stripAnsi(panel("Content", { padding: 2 }));
		const lines = result.split("\n");
		// With padding=2, there should be blank lines (just border + spaces) above and below content
		// Top border + 2 blank + content + 2 blank + bottom border = 7 lines
		expect(lines.length).toBe(7);
	});

	test("multiline content", () => {
		const result = stripAnsi(panel(["Line 1", "Line 2"]));
		expect(result).toContain("Line 1");
		expect(result).toContain("Line 2");
	});

	test("ASCII fallback uses ASCII borders", () => {
		setContext(asciiCtx);
		const result = stripAnsi(panel("Hello", { borderStyle: "single" }));
		expect(result).toContain("+");
		expect(result).toContain("|");
		expect(result).toContain("-");
	});
});

// ---------------------------------------------------------------------------
// columns
// ---------------------------------------------------------------------------

describe("columns", () => {
	beforeEach(() => setContext(fullCtx));

	test("side-by-side layout", () => {
		const result = stripAnsi(columns([{ content: "Left" }, { content: "Right" }]));
		expect(result).toContain("Left");
		expect(result).toContain("Right");
		// Single line output
		const lines = result.split("\n");
		expect(lines.length).toBe(1);
	});

	test("multi-line columns padded to same height", () => {
		const result = stripAnsi(columns([{ content: ["A1", "A2", "A3"] }, { content: ["B1"] }]));
		const lines = result.split("\n");
		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("A1");
		expect(lines[0]).toContain("B1");
		expect(lines[1]).toContain("A2");
		expect(lines[2]).toContain("A3");
	});

	test("respects explicit column widths", () => {
		const result = stripAnsi(
			columns([
				{ content: "A", width: 10 },
				{ content: "B", width: 10 },
			]),
		);
		const lines = result.split("\n");
		// Each column should be padded to 10 chars
		// Line = 10 + gap(2) + 10 = 22 chars
		expect(stringWidth(lines[0]!)).toBe(22);
	});

	test("alignment works", () => {
		const result = stripAnsi(
			columns([
				{ content: "L", width: 10, align: "left" },
				{ content: "R", width: 10, align: "right" },
			]),
		);
		const lines = result.split("\n");
		// Left aligned: 'L' at start
		expect(lines[0]!.startsWith("L")).toBe(true);
		// Right aligned: 'R' at end of its column area
		expect(lines[0]!.trimEnd().endsWith("R")).toBe(true);
	});

	test("custom gap", () => {
		const result = stripAnsi(
			columns(
				[
					{ content: "A", width: 2 },
					{ content: "B", width: 2 },
				],
				{ gap: 4 },
			),
		);
		const lines = result.split("\n");
		// 2 + 4 + 2 = 8
		expect(stringWidth(lines[0]!)).toBe(8);
	});

	test("ASCII fallback works", () => {
		setContext(asciiCtx);
		const result = stripAnsi(columns([{ content: "Hello" }, { content: "World" }]));
		expect(result).toContain("Hello");
		expect(result).toContain("World");
	});
});

// ---------------------------------------------------------------------------
// section
// ---------------------------------------------------------------------------

describe("section", () => {
	beforeEach(() => setContext(fullCtx));

	test("level 1 has title + divider + blank line + content", () => {
		const result = stripAnsi(section({ title: "Title", level: 1, content: "Body text" }));
		const lines = result.split("\n");
		expect(lines[0]).toBe("Title");
		// Line 1 should be a divider (─ chars)
		expect(lines[1]).toMatch(/[─\-]+/);
		// Line 2 should be blank
		expect(lines[2]).toBe("");
		// Line 3 is content
		expect(lines[3]).toBe("Body text");
	});

	test("level 2 has title + blank line + content", () => {
		const result = stripAnsi(section({ title: "SubTitle", level: 2, content: "Body" }));
		const lines = result.split("\n");
		expect(lines[0]).toBe("SubTitle");
		expect(lines[1]).toBe("");
		expect(lines[2]).toBe("Body");
	});

	test("level 3 has title + content, no blank line", () => {
		const result = stripAnsi(section({ title: "Minor", level: 3, content: "Body" }));
		const lines = result.split("\n");
		expect(lines[0]).toBe("Minor");
		expect(lines[1]).toBe("Body");
		expect(lines.length).toBe(2);
	});

	test("defaults to level 1", () => {
		const result = stripAnsi(section({ title: "Default", content: "Body" }));
		const lines = result.split("\n");
		// Should have divider (level 1 behavior)
		expect(lines[1]).toMatch(/[─\-]+/);
	});

	test("content as array", () => {
		const result = stripAnsi(section({ title: "T", level: 3, content: ["Line 1", "Line 2"] }));
		expect(result).toContain("Line 1");
		expect(result).toContain("Line 2");
	});

	test("title is styled with bold (level 1 and 2)", () => {
		const result = section({ title: "Styled", level: 2, content: "x" });
		expect(result).toContain("\x1b[1m"); // bold
	});

	test("ASCII fallback uses ASCII divider chars", () => {
		setContext(asciiCtx);
		const result = stripAnsi(section({ title: "Title", level: 1, content: "Body" }));
		const lines = result.split("\n");
		expect(lines[1]).toMatch(/^-+$/);
	});
});

// ---------------------------------------------------------------------------
// helpLayout
// ---------------------------------------------------------------------------

describe("helpLayout", () => {
	beforeEach(() => setContext(fullCtx));

	test("renders usage line", () => {
		const result = stripAnsi(helpLayout({ usage: "my-cli <command> [options]" }));
		expect(result).toContain("Usage: my-cli <command> [options]");
	});

	test("renders description", () => {
		const result = stripAnsi(
			helpLayout({
				usage: "cli",
				description: "A useful tool",
			}),
		);
		expect(result).toContain("A useful tool");
	});

	test("renders commands section", () => {
		const result = stripAnsi(
			helpLayout({
				usage: "cli",
				commands: [
					{ name: "init", description: "Initialize project" },
					{ name: "build", description: "Build project", alias: "b" },
				],
			}),
		);
		expect(result).toContain("Commands:");
		expect(result).toContain("init");
		expect(result).toContain("Initialize project");
		expect(result).toContain("build, b");
		expect(result).toContain("Build project");
	});

	test("renders flag groups", () => {
		const result = stripAnsi(
			helpLayout({
				usage: "cli",
				flagGroups: [
					{
						title: "Global Options",
						flags: [
							{ short: "v", long: "verbose", description: "Enable verbose output" },
							{
								long: "config",
								description: "Config file path",
								type: "string",
								default: "./config.json",
							},
							{ short: "f", long: "force", description: "Force overwrite", required: true },
						],
					},
				],
			}),
		);
		expect(result).toContain("Global Options:");
		expect(result).toContain("-v, --verbose");
		expect(result).toContain("--config");
		expect(result).toContain("Enable verbose output");
		expect(result).toContain("string");
		expect(result).toContain("default: ./config.json");
		expect(result).toContain("required");
	});

	test("renders examples", () => {
		const result = stripAnsi(
			helpLayout({
				usage: "cli",
				examples: [{ command: "cli init --template react", description: "Create a React project" }],
			}),
		);
		expect(result).toContain("Examples:");
		expect(result).toContain("cli init --template react");
		expect(result).toContain("Create a React project");
	});

	test("renders footer", () => {
		const result = stripAnsi(
			helpLayout({
				usage: "cli",
				footer: "For more info, visit https://example.com",
			}),
		);
		expect(result).toContain("For more info, visit https://example.com");
	});

	test("full help layout with all sections", () => {
		const result = stripAnsi(
			helpLayout({
				usage: "my-app <command>",
				description: "My amazing app",
				commands: [{ name: "start", description: "Start the server" }],
				flagGroups: [
					{
						title: "Options",
						flags: [
							{
								short: "p",
								long: "port",
								description: "Port number",
								type: "number",
								default: "3000",
							},
						],
					},
				],
				examples: [{ command: "my-app start -p 8080", description: "Start on port 8080" }],
				footer: "v1.0.0",
			}),
		);
		expect(result).toContain("Usage:");
		expect(result).toContain("My amazing app");
		expect(result).toContain("Commands:");
		expect(result).toContain("Options:");
		expect(result).toContain("Examples:");
		expect(result).toContain("v1.0.0");
	});

	test("ASCII fallback works", () => {
		setContext(asciiCtx);
		const result = stripAnsi(
			helpLayout({
				usage: "cli",
				commands: [{ name: "test", description: "Run tests" }],
			}),
		);
		expect(result).toContain("Usage: cli");
		expect(result).toContain("test");
	});
});
