import { beforeEach, describe, expect, test } from "vitest";
import { createContext, setContext } from "#primitives/context";
import { stripAnsi } from "#render/index";
import { c, getSymbols, getTokens, md, msg, s } from "#shortcuts";

// Force truecolor + unicode context for deterministic output
beforeEach(() => {
	const ctx = createContext({ colorDepth: "truecolor", unicode: true, columns: 80 });
	setContext(ctx);
});

// ---------------------------------------------------------------------------
// md — inline markdown
// ---------------------------------------------------------------------------

describe("md", () => {
	test("renders inline code with code color", () => {
		const result = md("use `command` here");
		expect(result).not.toBe("use `command` here"); // has ANSI
		expect(stripAnsi(result)).toBe("use command here");
	});

	test("renders bold text", () => {
		const result = md("this is **bold** text");
		expect(stripAnsi(result)).toBe("this is bold text");
		expect(result).toContain("\x1b["); // has ANSI codes
	});

	test("renders dim text with single asterisks", () => {
		const result = md("this is *dim* text");
		expect(stripAnsi(result)).toBe("this is dim text");
	});

	test("does not confuse bold and dim", () => {
		const result = md("**bold** and *dim*");
		expect(stripAnsi(result)).toBe("bold and dim");
	});

	test("passes plain text through unchanged", () => {
		const result = md("no formatting");
		expect(result).toBe("no formatting");
	});
});

// ---------------------------------------------------------------------------
// c — color functions
// ---------------------------------------------------------------------------

describe("c", () => {
	test("success applies success color", () => {
		const result = c.success("ok");
		expect(stripAnsi(result)).toBe("ok");
		expect(result).toContain("\x1b[");
	});

	test("error applies error color", () => {
		const result = c.error("fail");
		expect(stripAnsi(result)).toBe("fail");
	});

	test("warning applies warning color", () => {
		const result = c.warning("warn");
		expect(stripAnsi(result)).toBe("warn");
	});

	test("info applies info color", () => {
		const result = c.info("note");
		expect(stripAnsi(result)).toBe("note");
	});

	test("muted applies dim style", () => {
		const result = c.muted("gray");
		expect(stripAnsi(result)).toBe("gray");
	});

	test("command applies code color", () => {
		const result = c.command("hyper run");
		expect(stripAnsi(result)).toBe("hyper run");
	});

	test("danger applies bold error", () => {
		const result = c.danger("DELETE");
		expect(stripAnsi(result)).toBe("DELETE");
	});

	test("text returns text unchanged", () => {
		expect(c.text("hello")).toBe("hello");
	});

	test("bold applies bold", () => {
		const result = c.bold("strong");
		expect(stripAnsi(result)).toBe("strong");
		expect(result).toContain("\x1b[1m");
	});

	test("dim applies dim", () => {
		const result = c.dim("faded");
		expect(stripAnsi(result)).toBe("faded");
	});

	test("subtle is an alias for dim", () => {
		const result = c.subtle("soft");
		expect(stripAnsi(result)).toBe("soft");
	});

	test("highlight applies info color", () => {
		expect(stripAnsi(c.highlight("focus"))).toBe("focus");
	});

	test("kit applies accent color", () => {
		expect(stripAnsi(c.kit("nextjs"))).toBe("nextjs");
	});

	test("recipe applies bold info", () => {
		expect(stripAnsi(c.recipe("crud"))).toBe("crud");
	});

	test("cookbook applies bold accent", () => {
		expect(stripAnsi(c.cookbook("docs"))).toBe("docs");
	});

	test("helper applies warning", () => {
		expect(stripAnsi(c.helper("Variables:"))).toBe("Variables:");
	});

	test("property applies info", () => {
		expect(stripAnsi(c.property("name"))).toBe("name");
	});

	test("required applies bold error", () => {
		expect(stripAnsi(c.required("*required*"))).toBe("*required*");
	});

	test("default formats value with dim", () => {
		const result = c.default("hello");
		expect(stripAnsi(result)).toBe(' (default: "hello")');
	});

	test("enum applies warning", () => {
		expect(stripAnsi(c.enum("string|number"))).toBe("string|number");
	});

	test("title applies bold info", () => {
		expect(stripAnsi(c.title("My Title"))).toBe("My Title");
	});

	test("heading applies bold warning", () => {
		expect(stripAnsi(c.heading("Section"))).toBe("Section");
	});

	test("version applies dim", () => {
		expect(stripAnsi(c.version("1.0.0"))).toBe("1.0.0");
	});
});

// ---------------------------------------------------------------------------
// s — composite style formatters
// ---------------------------------------------------------------------------

describe("s", () => {
	test("hint applies dim", () => {
		expect(stripAnsi(s.hint("try this"))).toBe("try this");
	});

	test("success prepends success symbol", () => {
		const result = stripAnsi(s.success("done"));
		expect(result).toContain("done");
		expect(result.length).toBeGreaterThan("done".length);
	});

	test("error prepends error symbol", () => {
		const result = stripAnsi(s.error("failed"));
		expect(result).toContain("failed");
	});

	test("warning prepends warning symbol", () => {
		const result = stripAnsi(s.warning("watch out"));
		expect(result).toContain("watch out");
	});

	test("info prepends info symbol", () => {
		const result = stripAnsi(s.info("FYI"));
		expect(result).toContain("FYI");
	});

	test("section applies bold info", () => {
		expect(stripAnsi(s.section("Commands"))).toBe("Commands");
	});

	test("code wraps in backticks", () => {
		expect(stripAnsi(s.code("foo"))).toBe("`foo`");
	});

	test("highlight applies bold info", () => {
		expect(stripAnsi(s.highlight("important"))).toBe("important");
	});

	test("title formats prefix: text", () => {
		expect(stripAnsi(s.title("Cookbook", "docs"))).toBe("Cookbook: docs");
	});

	test("hr returns a divider", () => {
		const result = s.hr();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("keyValue formats key: value", () => {
		const result = stripAnsi(s.keyValue("Name", "test"));
		expect(result).toContain("Name:");
		expect(result).toContain("test");
	});

	test("keyValue with indent", () => {
		const result = stripAnsi(s.keyValue("Key", "val", 4));
		expect(result.startsWith("    ")).toBe(true);
	});

	test("header formats text with optional count", () => {
		expect(stripAnsi(s.header("Items"))).toBe("Items");
		expect(stripAnsi(s.header("Items", 5))).toBe("Items (5)");
	});

	test("description applies dim with indent", () => {
		expect(stripAnsi(s.description("desc", 2))).toBe("    desc");
		expect(stripAnsi(s.description("desc"))).toBe("    desc");
	});

	test("listItem prepends bullet", () => {
		const result = stripAnsi(s.listItem("item"));
		expect(result).toContain("item");
		expect(result).toMatch(/^\s+.+item$/);
	});

	test("indent adds spaces", () => {
		expect(s.indent("text", 4)).toBe("    text");
	});

	test("path applies dim", () => {
		expect(stripAnsi(s.path("/some/path"))).toBe("/some/path");
	});

	test("version applies dim", () => {
		expect(stripAnsi(s.version("2.0"))).toBe("2.0");
	});

	test("md is the md function", () => {
		expect(s.md).toBe(md);
	});
});

// ---------------------------------------------------------------------------
// msg — structured messages
// ---------------------------------------------------------------------------

describe("msg", () => {
	test("error with string produces error message", () => {
		const result = msg.error("something broke");
		expect(stripAnsi(result)).toContain("something broke");
	});

	test("warning with string", () => {
		const result = msg.warning("be careful");
		expect(stripAnsi(result)).toContain("be careful");
	});

	test("success with string", () => {
		const result = msg.success("all good");
		expect(stripAnsi(result)).toContain("all good");
	});

	test("info with string", () => {
		const result = msg.info("FYI");
		expect(stripAnsi(result)).toContain("FYI");
	});

	test("tip with string", () => {
		const result = msg.tip("try this");
		expect(stripAnsi(result)).toContain("try this");
	});

	test("error with props object (title + summary)", () => {
		const result = msg.error({
			title: "Connection failed",
			summary: "database unreachable",
		});
		const plain = stripAnsi(result);
		expect(plain).toContain("Error:");
		expect(plain).toContain("Connection failed");
		expect(plain).toContain("database unreachable");
	});

	test("tip with props (title + summary + body)", () => {
		const result = msg.tip({
			title: "Did you mean?",
			summary: "Available commands",
			body: ["hyper run", "hyper kit install"],
		});
		const plain = stripAnsi(result);
		expect(plain).toContain("Tip:");
		expect(plain).toContain("Did you mean?");
		expect(plain).toContain("Available commands");
		expect(plain).toContain("hyper run");
		expect(plain).toContain("hyper kit install");
	});

	test("info with body as string", () => {
		const result = msg.info({
			title: "Note",
			summary: "Details below",
			body: "line1\nline2",
		});
		const plain = stripAnsi(result);
		expect(plain).toContain("line1");
		expect(plain).toContain("line2");
	});
});

// ---------------------------------------------------------------------------
// symbols & tokens
// ---------------------------------------------------------------------------

describe("getSymbols / getTokens", () => {
	test("getSymbols returns resolved symbols", () => {
		const syms = getSymbols();
		expect(typeof syms.success).toBe("string");
		expect(typeof syms.error).toBe("string");
		expect(typeof syms.warning).toBe("string");
	});

	test("getTokens returns resolved tokens", () => {
		const tok = getTokens();
		expect(tok.color).toBeDefined();
		expect(tok.space).toBeDefined();
		expect(tok.symbol).toBeDefined();
	});
});
