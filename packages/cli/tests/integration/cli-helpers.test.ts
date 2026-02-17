import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { hasCommand, hasTopic, parseCommands, runCLI, runDevCLI } from "#tests/helpers/cli";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

describe("CLI Helpers", () => {
	describe("runCLI", () => {
		it("should run CLI and return stdout", async () => {
			const result = await runCLI(["--version"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("@hypercli/cli");
		});

		it("should capture error output on invalid command", async () => {
			const result = await runCLI(["invalid-command"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout.length).toBeGreaterThan(0);
		});

		it("should respect cwd option", async () => {
			const result = await runCLI(["--version"], { cwd: process.cwd() });
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(pkg.version);
		});

		it("should respect env option", async () => {
			const result = await runCLI(["--version"], {
				env: { NODE_ENV: "production" },
			});
			expect(result.exitCode).toBe(0);
		});
	});

	describe("runDevCLI", () => {
		it("should run dev CLI and return stdout", async () => {
			const result = await runDevCLI(["--version"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("@hypercli/cli");
		});

		it("should capture error output on invalid command in dev mode", async () => {
			const result = await runDevCLI(["invalid-command"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout.length).toBeGreaterThan(0);
		});
	});

	describe("hasCommand", () => {
		it("should return true for existing command", () => {
			const output = "  gen <recipe>  Run a recipe\n  kit <command>  Kit management";
			expect(hasCommand(output, "gen")).toBe(true);
		});

		it("should return false for non-existing command", () => {
			const output = "  gen <recipe>  Run a recipe\n  kit <command>  Kit management";
			expect(hasCommand(output, "invalid")).toBe(false);
		});

		it("should handle commands with special regex characters", () => {
			const output = "  kit:install <source>  Install a kit";
			expect(hasCommand(output, "kit:install")).toBe(true);
		});

		it("should match command at start of line", () => {
			const output = "  gen <recipe>  Run a recipe";
			expect(hasCommand(output, "gen")).toBe(true);
		});
	});

	describe("hasTopic", () => {
		it("should return true for existing topic", () => {
			const output = "  kit  Kit management commands";
			expect(hasTopic(output, "kit")).toBe(true);
		});

		it("should return false for non-existing topic", () => {
			const output = "  kit  Kit management commands";
			expect(hasTopic(output, "invalid")).toBe(false);
		});
	});

	describe("parseCommands", () => {
		it("should parse commands from help output", () => {
			const output = `COMMANDS
  gen <recipe>  Run a recipe
  kit <command>  Kit management

TOPICS
  recipe  Recipe commands`;
			const commands = parseCommands(output);
			expect(commands).toContain("gen");
			expect(commands).toContain("kit");
		});

		it("should return empty array when no commands section", () => {
			const output = "Some random output without commands";
			const commands = parseCommands(output);
			expect(commands).toEqual([]);
		});

		it("should handle empty lines in commands section", () => {
			const output = `COMMANDS
  gen <recipe>  Run a recipe

  kit <command>  Kit management`;
			const commands = parseCommands(output);
			expect(commands).toContain("gen");
			expect(commands).toContain("kit");
		});

		it("should handle command without description", () => {
			const output = `COMMANDS
  gen  `;
			const commands = parseCommands(output);
			expect(commands).toContain("gen");
		});

		it("should stop at next section header", () => {
			const output = `COMMANDS
  gen <recipe>  Run a recipe
TOPICS
  kit  Kit management`;
			const commands = parseCommands(output);
			expect(commands).toContain("gen");
			expect(commands).not.toContain("kit");
		});
	});
});
