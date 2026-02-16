import { describe, expect, it } from "@jest/globals";
import { hello } from "./index.js";

describe("sample-lib", () => {
	it("should greet correctly", () => {
		expect(hello("World")).toBe("Hello, World!");
	});

	it("should handle empty string", () => {
		expect(hello("")).toBe("Hello, !");
	});
});
