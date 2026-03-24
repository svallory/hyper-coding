import { describe, expect, it } from "vitest";
import { sanitizeSessionName } from "#services/tmux";

describe("sanitizeSessionName", () => {
	it("replaces dots with hyphens", () => {
		expect(sanitizeSessionName("my.session")).toBe("my-session");
	});

	it("replaces colons with hyphens", () => {
		expect(sanitizeSessionName("my:session")).toBe("my-session");
	});

	it("replaces multiple dots", () => {
		expect(sanitizeSessionName("a.b.c.d")).toBe("a-b-c-d");
	});

	it("replaces multiple colons", () => {
		expect(sanitizeSessionName("a:b:c:d")).toBe("a-b-c-d");
	});

	it("replaces mixed dots and colons", () => {
		expect(sanitizeSessionName("project.name:v2.0")).toBe("project-name-v2-0");
	});

	it("leaves clean names unchanged", () => {
		expect(sanitizeSessionName("my-session")).toBe("my-session");
	});

	it("leaves names with only alphanumerics and hyphens unchanged", () => {
		expect(sanitizeSessionName("session-123-abc")).toBe("session-123-abc");
	});

	it("handles empty string", () => {
		expect(sanitizeSessionName("")).toBe("");
	});

	it("handles string with only special characters", () => {
		expect(sanitizeSessionName(".:.:")).toBe("----");
	});

	it("handles consecutive dots and colons", () => {
		expect(sanitizeSessionName("a..b::c")).toBe("a--b--c");
	});

	it("preserves underscores and other allowed characters", () => {
		expect(sanitizeSessionName("my_session.v2")).toBe("my_session-v2");
	});

	it("handles single dot", () => {
		expect(sanitizeSessionName(".")).toBe("-");
	});

	it("handles single colon", () => {
		expect(sanitizeSessionName(":")).toBe("-");
	});
});
