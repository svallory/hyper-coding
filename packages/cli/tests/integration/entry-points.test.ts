import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, "../../bin");

describe("Entry Points", () => {
	describe("bin/run.js", () => {
		it("should execute with --version", async () => {
			const result = await execa("bun", [path.join(binDir, "run.js"), "--version"], {
				reject: false,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("@hypercli/cli");
		});

		it("should execute with --help", async () => {
			const result = await execa("bun", [path.join(binDir, "run.js"), "--help"], {
				reject: false,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hyper");
		});

		it("should handle unknown commands", async () => {
			const result = await execa("bun", [path.join(binDir, "run.js"), "unknown"], {
				reject: false,
			});
			expect(result.exitCode).not.toBe(0);
		});

		it("should load plugins and show commands", async () => {
			const result = await execa("bun", [path.join(binDir, "run.js"), "--help"], {
				reject: false,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("gen");
			expect(result.stdout).toContain("kit");
		});
	});

	describe("bin/dev.js", () => {
		it("should execute with --version", async () => {
			const result = await execa("bun", [path.join(binDir, "dev.js"), "--version"], {
				reject: false,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("@hypercli/cli");
		});

		it("should execute with --help", async () => {
			const result = await execa("bun", [path.join(binDir, "dev.js"), "--help"], {
				reject: false,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hyper");
		});

		it("should handle unknown commands", async () => {
			const result = await execa("bun", [path.join(binDir, "dev.js"), "unknown"], {
				reject: false,
			});
			expect(result.exitCode).not.toBe(0);
		});
	});
});
