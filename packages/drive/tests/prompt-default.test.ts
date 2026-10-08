import { describe, expect, it } from "vitest";
import { promptValidation, promptValue } from "#lib/prompt-default";

/**
 * These two rules are the whole of "Enter accepts the default" in a
 * `@clack/prompts` text prompt.
 *
 * `tests/drive-setup.test.ts` covers the same ground end to end through a pty
 * (`script -q /dev/null`), which is the only place the real prompt can be
 * driven. This suite stays because it pins the rules directly: the pty test
 * takes ~11 s of real waiting, and these two functions are where the
 * regression would otherwise land.
 */
describe("promptValidation", () => {
	it("accepts Enter when a default exists", () => {
		// The bug this guards: clack runs `validate` on the raw input BEFORE
		// applying `defaultValue`, so rejecting every empty value made Enter on
		// a defaulted question an error that could never be accepted.
		expect(promptValidation("name", "", "my-laptop")).toBeUndefined();
		expect(promptValidation("name", "   ", "my-laptop")).toBeUndefined();
		expect(promptValidation("name", undefined, "my-laptop")).toBeUndefined();
	});

	it("accepts a typed value with or without a default", () => {
		expect(promptValidation("name", "typed", "my-laptop")).toBeUndefined();
		expect(promptValidation("remote", "git@example.com:d.git", "")).toBeUndefined();
	});

	it("rejects an empty answer only when there is nothing to fall back to", () => {
		expect(promptValidation("remote", "", "")).toContain("--remote");
		expect(promptValidation("remote", "   ", "")).toContain("--remote");
		expect(promptValidation("remote", undefined, "")).toContain("--remote");
	});
});

describe("promptValue", () => {
	it("falls back to the default when the answer is empty", () => {
		expect(promptValue("", "my-laptop")).toBe("my-laptop");
		expect(promptValue("   ", "my-laptop")).toBe("my-laptop");
	});

	it("keeps a typed answer, trimmed", () => {
		expect(promptValue("  typed  ", "my-laptop")).toBe("typed");
	});
});
