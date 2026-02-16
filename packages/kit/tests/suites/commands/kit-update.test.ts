/**
 * Tests for kit update command
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type KitManifestEntry, loadManifest, saveManifest } from "../../../src/manifest.js";
import {
	createKitDir,
	createMonorepoProject,
	createTempProject,
} from "../../helpers/temp-project.js";

// Mock dependencies at top level
const mockExecSync = vi.fn();

vi.mock("node:child_process", () => ({
	execSync: (...args: any[]) => mockExecSync(...args),
}));

// Mock giget to actually create the target directory (simulating a download)
vi.mock("giget", () => ({
	downloadTemplate: vi.fn(async (source: string, options: { dir: string; force?: boolean }) => {
		// Simulate download by creating the target directory
		mkdirSync(options.dir, { recursive: true });
		// Create a package.json with version 2.0.0 to simulate updated kit
		writeFileSync(
			join(options.dir, "package.json"),
			JSON.stringify({ name: "my-kit", version: "2.0.0" }),
		);
	}),
}));

import * as giget from "giget";
// Import command after mocks
import KitUpdate from "../../../src/commands/kit/update.js";

// Get reference to the mocked function for assertions
const mockDownloadTemplate = giget.downloadTemplate as ReturnType<typeof vi.fn>;

describe("KitUpdate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("command properties", () => {
		it("has correct description", () => {
			expect(KitUpdate.description).toBe("Update installed kits from their original source");
		});

		it("defines all flag", () => {
			expect(KitUpdate.flags.all).toBeDefined();
		});

		it("defines base flags", () => {
			expect(KitUpdate.flags.cwd).toBeDefined();
			expect(KitUpdate.flags.debug).toBeDefined();
		});
	});

	describe("updateKit", () => {
		it("skips npm kits with message", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "npm-kit", { version: "1.0.0" });

			const manifestEntry: KitManifestEntry = {
				name: "npm-kit",
				source: "@hypergen/npm-kit",
				type: "npm",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "npm-kit": manifestEntry } });

			const cmd = new KitUpdate(["npm-kit"], { cwd: project.root } as any);
			await cmd.init();

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			// Call updateKit directly instead of run()
			await (cmd as any).updateKit(project.root, "npm-kit", manifestEntry);

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("npm/JSR kits are updated through your package manager"),
			);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("skips jsr kits with message", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "jsr-kit", { version: "1.0.0" });

			const manifestEntry: KitManifestEntry = {
				name: "jsr-kit",
				source: "jsr:@std/path",
				type: "jsr",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "jsr-kit": manifestEntry } });

			const cmd = new KitUpdate(["jsr-kit"], { cwd: project.root } as any);
			await cmd.init();

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "jsr-kit", manifestEntry);

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("npm/JSR kits are updated through your package manager"),
			);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("removes existing dir before re-downloading", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const kitDir = createKitDir(project.root, "my-kit", { version: "1.0.0" });
			writeFileSync(join(kitDir, "old-file.txt"), "old content");

			const manifestEntry: KitManifestEntry = {
				name: "my-kit",
				source: "github:user/my-kit",
				type: "github",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "my-kit": manifestEntry } });

			const cmd = new KitUpdate(["my-kit"], { cwd: project.root } as any);
			await cmd.init();
			// Set flags for testing
			(cmd as any).flags = { cwd: project.root, debug: false };

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "my-kit", manifestEntry);

			expect(mockDownloadTemplate).toHaveBeenCalled();
			expect(existsSync(join(kitDir, "old-file.txt"))).toBe(false);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("re-installs from github source", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "my-kit", { version: "1.0.0" });

			const manifestEntry: KitManifestEntry = {
				name: "my-kit",
				source: "github:user/my-kit",
				type: "github",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "my-kit": manifestEntry } });

			const cmd = new KitUpdate(["my-kit"], { cwd: project.root } as any);
			await cmd.init();
			(cmd as any).flags = { cwd: project.root, debug: false };

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "my-kit", manifestEntry);

			expect(mockDownloadTemplate).toHaveBeenCalledWith(
				"github:user/my-kit",
				expect.objectContaining({ force: true }),
			);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("re-installs from git URL", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "my-kit", { version: "1.0.0" });

			const manifestEntry: KitManifestEntry = {
				name: "my-kit",
				source: "https://gitlab.com/user/my-kit.git",
				type: "git",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "my-kit": manifestEntry } });

			const cmd = new KitUpdate(["my-kit"], { cwd: project.root } as any);
			await cmd.init();
			(cmd as any).flags = { cwd: project.root, debug: false };

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "my-kit", manifestEntry);

			expect(mockDownloadTemplate).toHaveBeenCalledWith(
				"https://gitlab.com/user/my-kit.git",
				expect.objectContaining({ force: true }),
			);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("re-installs from local path", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const kitDir = createKitDir(project.root, "my-kit", { version: "1.0.0" });

			// Create source directory
			const sourceDir = join(project.root, "source-kit");
			mkdirSync(sourceDir, { recursive: true });
			writeFileSync(
				join(sourceDir, "package.json"),
				JSON.stringify({ name: "source-kit", version: "2.0.0" }),
			);

			const manifestEntry: KitManifestEntry = {
				name: "my-kit",
				source: sourceDir,
				type: "local",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "my-kit": manifestEntry } });

			const cmd = new KitUpdate(["my-kit"], { cwd: project.root } as any);
			await cmd.init();
			(cmd as any).flags = { cwd: project.root, debug: false };

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "my-kit", manifestEntry);

			// Should have copied new content
			expect(existsSync(join(kitDir, "package.json"))).toBe(true);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("updates manifest with new metadata", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "my-kit", { version: "2.0.0" });

			const oldDate = "2026-02-10T00:00:00.000Z";
			const manifestEntry: KitManifestEntry = {
				name: "my-kit",
				source: "github:user/my-kit",
				type: "github",
				installedAt: oldDate,
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "my-kit": manifestEntry } });

			const cmd = new KitUpdate(["my-kit"], { cwd: project.root } as any);
			await cmd.init();
			(cmd as any).flags = { cwd: project.root, debug: false };

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "my-kit", manifestEntry);

			const manifest = loadManifest(project.root);
			expect(manifest.kits["my-kit"].version).toBe("2.0.0");
			expect(manifest.kits["my-kit"].installedAt).not.toBe(oldDate);

			logSpy.mockRestore();
			project.cleanup();
		});

		it("shows version diff in output", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "my-kit", { version: "2.0.0" });

			const manifestEntry: KitManifestEntry = {
				name: "my-kit",
				source: "github:user/my-kit",
				type: "github",
				installedAt: "2026-02-10T00:00:00.000Z",
				version: "1.0.0",
			};
			saveManifest(project.root, { version: "1.0.0", kits: { "my-kit": manifestEntry } });

			const cmd = new KitUpdate(["my-kit"], { cwd: project.root } as any);
			await cmd.init();
			(cmd as any).flags = { cwd: project.root, debug: false };

			const logSpy = vi.spyOn(cmd, "log").mockImplementation(() => {});

			await (cmd as any).updateKit(project.root, "my-kit", manifestEntry);

			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("v2.0.0"));
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("was v1.0.0"));

			logSpy.mockRestore();
			project.cleanup();
		});
	});
});
