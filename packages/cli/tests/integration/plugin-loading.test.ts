import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasCommand, parseCommands, runCLI } from "#tests/helpers/cli";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../fixtures/workspace");

describe("Plugin Loading", () => {
	describe("Help and version", () => {
		it("should show help with --help flag", async () => {
			const result = await runCLI(["--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hyper");
			expect(result.stdout.toLowerCase()).toContain("usage");
		});

		it("should show version with --version flag", async () => {
			const result = await runCLI(["--version"]);
			expect(result.exitCode).toBe(0);
			// oclif outputs full version string: @hypercli/cli/X.Y.Z darwin-arm64 node-vXX.X.X
			expect(result.stdout).toContain(pkg.version);
			expect(result.stdout).toContain("@hypercli/cli");
		});

		it("should handle -v flag", async () => {
			const result = await runCLI(["-v"]);
			// oclif handles -v (exits 0 but may not output version)
			expect(result.exitCode).toBe(0);
		});
	});

	describe("Plugin discovery", () => {
		it("should load @oclif/plugin-help", async () => {
			const result = await runCLI(["--help"]);
			expect(result.exitCode).toBe(0);
			// Help command should be available
			expect(result.stdout).toContain("hyper");
		});

		it("should discover @hypercli/gen plugin commands", async () => {
			const result = await runCLI(["--help"]);
			expect(result.exitCode).toBe(0);
			// The gen plugin should contribute the 'gen' command
			// Check directly in stdout since parseCommands may have issues
			expect(result.stdout).toContain("gen");
			expect(result.stdout).toContain("COMMANDS");
		});

		it(
			"should discover @hypercli/kit plugin commands",
			async () => {
				const result = await runCLI(["--help"]);
				expect(result.exitCode).toBe(0);
				// The kit plugin should contribute the 'kit' topic
				expect(result.stdout).toContain("kit");
			},
			{ timeout: 30000 },
		);

		it("should show cookbook topic from gen plugin", async () => {
			const result = await runCLI(["--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("cookbook");
		});

		it("should show recipe topic from gen plugin", async () => {
			const result = await runCLI(["--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("recipe");
		});
	});

	describe("Command routing", () => {
		it('should route "hyper gen --help" to gen plugin', async () => {
			const result = await runCLI(["gen", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("gen");
			expect(result.stdout.toLowerCase()).toContain("recipe");
		});

		it('should route "hyper kit --help" to kit plugin', async () => {
			const result = await runCLI(["kit", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("kit");
		});

		it('should route "hyper kit:install --help" to kit plugin', async () => {
			const result = await runCLI(["kit:install", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("install");
		});

		it('should route "hyper recipe --help" to gen plugin', async () => {
			const result = await runCLI(["recipe", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("recipe");
		});

		it('should route "hyper cookbook --help" to gen plugin', async () => {
			const result = await runCLI(["cookbook", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("cookbook");
		});
	});

	describe("Error handling", () => {
		it("should handle unknown commands gracefully", async () => {
			const result = await runCLI(["nonexistent-command"]);
			// Should fail with non-zero exit code
			expect(result.exitCode).not.toBe(0);
			// Should show error message on stdout (command-not-found hook uses console.log)
			expect(result.stdout).toMatch(
				/(nonexistent-command|not found|unknown command|couldn't find)/i,
			);
		});

		it("should suggest alternatives for misspelled commands", async () => {
			const result = await runCLI(["runn"]);
			// Should fail
			expect(result.exitCode).not.toBe(0);
			// Error output should exist on stdout (command-not-found hook uses console.log)
			expect(result.stdout.length).toBeGreaterThan(0);
			// Should contain suggestion or error about the command
			expect(result.stdout).toMatch(/(runn|did you mean|couldn't find)/i);
		});

		it("should handle empty command", async () => {
			const result = await runCLI([]);
			// Should show help when no command given
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hyper");
		});
	});

	describe("Working directory handling", () => {
		it("should work from fixture workspace", async () => {
			const result = await runCLI(["--help"], { cwd: fixtureDir });
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("hyper");
		});

		it("should show version from fixture workspace", async () => {
			const result = await runCLI(["--version"], { cwd: fixtureDir });
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(pkg.version);
			expect(result.stdout).toContain("@hypercli/cli");
		});
	});

	describe("Kit subcommands", () => {
		it("should list all kit subcommands", async () => {
			const result = await runCLI(["kit", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("install");
			expect(result.stdout).toContain("list");
			expect(result.stdout).toContain("update");
			expect(result.stdout).toContain("info");
		});
	});

	describe("Recipe subcommands", () => {
		it("should list all recipe subcommands", async () => {
			const result = await runCLI(["recipe", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("list");
			expect(result.stdout).toContain("run");
			expect(result.stdout).toContain("info");
			expect(result.stdout).toContain("validate");
		});
	});

	describe("Cookbook subcommands", () => {
		it("should list all cookbook subcommands", async () => {
			const result = await runCLI(["cookbook", "--help"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("list");
			expect(result.stdout).toContain("info");
		});
	});
});
