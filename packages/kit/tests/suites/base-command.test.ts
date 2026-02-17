/**
 * Tests for BaseCommand class
 */

import { Command } from "@oclif/core";
import { describe, expect, it } from "vitest";
import { BaseCommand } from "#base-command";
import { createTempProject } from "../helpers/temp-project.js";

// Create a concrete test command since BaseCommand is abstract
class TestCommand extends BaseCommand<typeof TestCommand> {
	static override description = "Test command for BaseCommand";

	async run(): Promise<void> {
		// No-op
	}

	// Expose protected method for testing
	public testDetectPackageManager(): "bun" | "pnpm" | "yarn" | "npm" {
		return this.detectPackageManager();
	}

	// Allow setting flags for testing
	public setTestFlags(flags: { cwd?: string; debug?: boolean }): void {
		(this.flags as any) = flags;
	}
}

describe("BaseCommand", () => {
	describe("baseFlags", () => {
		it("defines cwd flag", () => {
			expect(TestCommand.baseFlags.cwd).toBeDefined();
			expect(TestCommand.baseFlags.cwd.description).toBe("Working directory");
		});

		it("defines debug flag", () => {
			expect(TestCommand.baseFlags.debug).toBeDefined();
			expect(TestCommand.baseFlags.debug.description).toBe("Enable debug output");
		});
	});

	describe("detectPackageManager", () => {
		it("returns 'bun' when bun.lockb exists", () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "bun",
			});

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("bun");

			project.cleanup();
		});

		it("returns 'pnpm' when pnpm-lock.yaml exists", () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "pnpm",
			});

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("pnpm");

			project.cleanup();
		});

		it("returns 'yarn' when yarn.lock exists", () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "yarn",
			});

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("yarn");

			project.cleanup();
		});

		it("returns 'npm' when package-lock.json exists", () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "npm",
			});

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("npm");

			project.cleanup();
		});

		it("returns packageManager from package.json when no lockfile", () => {
			const project = createTempProject({
				packageJson: { name: "test", packageManager: "pnpm@8.0.0" },
			});

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("pnpm");

			project.cleanup();
		});

		it("defaults to 'npm' when nothing found", () => {
			const project = createTempProject({
				packageJson: { name: "test" },
			});

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("npm");

			project.cleanup();
		});

		it("handles malformed package.json gracefully", () => {
			const project = createTempProject();
			// No package.json created

			const cmd = new TestCommand([], { cwd: project.root } as any);
			cmd.setTestFlags({ cwd: project.root });
			const result = cmd.testDetectPackageManager();

			expect(result).toBe("npm");

			project.cleanup();
		});
	});
});
