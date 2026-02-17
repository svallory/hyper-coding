/**
 * Tests for kit install command
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type KitManifestEntry, loadManifest } from "../../../src/manifest.js";
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
	downloadTemplate: vi.fn(async (source: string, options: { dir: string }) => {
		// Simulate download by creating the target directory
		mkdirSync(options.dir, { recursive: true });
	}),
}));

import * as giget from "giget";
// Import command after mocks
import KitInstall from "../../../src/commands/kit/install.js";

// Get reference to the mocked function for assertions
const mockDownloadTemplate = giget.downloadTemplate as ReturnType<typeof vi.fn>;

describe("KitInstall", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("extractKitName", () => {
		it("extracts repo name from github:user/repo", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const cmd = new KitInstall(["github:user/my-repo"], { cwd: project.root } as any);
			await cmd.init();

			const result = (cmd as any).extractKitName({ type: "github", source: "github:user/my-repo" });
			expect(result).toBe("my-repo");

			project.cleanup();
		});

		it("extracts repo name from github:user/repo#branch", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const cmd = new KitInstall(["github:user/my-repo#main"], { cwd: project.root } as any);
			await cmd.init();

			const result = (cmd as any).extractKitName({
				type: "github",
				source: "github:user/my-repo#main",
			});
			expect(result).toBe("my-repo");

			project.cleanup();
		});

		it("extracts name from git URL", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const cmd = new KitInstall(["https://github.com/user/repo.git"], {
				cwd: project.root,
			} as any);
			await cmd.init();

			const result = (cmd as any).extractKitName({
				type: "git",
				source: "https://github.com/user/repo.git",
			});
			expect(result).toBe("repo");

			project.cleanup();
		});

		it("uses basename for local path", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const cmd = new KitInstall(["./my-local-kit"], { cwd: project.root } as any);
			await cmd.init();

			const result = (cmd as any).extractKitName({ type: "local", source: "./my-local-kit" });
			expect(result).toBe("my-local-kit");

			project.cleanup();
		});

		it("extracts filename from URL", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const cmd = new KitInstall(["https://example.com/kit.tar.gz"], { cwd: project.root } as any);
			await cmd.init();

			const result = (cmd as any).extractKitName({
				type: "url",
				source: "https://example.com/kit.tar.gz",
			});
			expect(result).toBe("kit");

			project.cleanup();
		});

		it("falls back to 'kit' for unknown types", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const cmd = new KitInstall(["something"], { cwd: project.root } as any);
			await cmd.init();

			const result = (cmd as any).extractKitName({ type: "unknown", source: "something" });
			expect(result).toBe("kit");

			project.cleanup();
		});
	});

	describe("installPackage", () => {
		it("calls execSync with correct bun command", async () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "bun",
			});

			const cmd = new KitInstall(["@hypergen/kit"], { cwd: project.root } as any);
			await cmd.init();
			// Set flags manually for testing
			(cmd as any).flags = { cwd: project.root, debug: false };

			await (cmd as any).installPackage(
				{ type: "npm", source: "@hypergen/kit", original: "@hypergen/kit" },
				{ dev: false, name: undefined, force: false, cwd: project.root, debug: false },
			);

			expect(mockExecSync).toHaveBeenCalledWith(
				expect.stringContaining("bun add"),
				expect.any(Object),
			);

			project.cleanup();
		});

		it("passes --dev flag correctly", async () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "bun",
			});

			const cmd = new KitInstall(["@hypergen/kit"], { cwd: project.root } as any);
			await cmd.init();
			// Set flags manually for testing
			(cmd as any).flags = { cwd: project.root, debug: false };

			await (cmd as any).installPackage(
				{ type: "npm", source: "@hypergen/kit", original: "@hypergen/kit" },
				{ dev: true, name: undefined, force: false, cwd: project.root, debug: false },
			);

			expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("-d"), expect.any(Object));

			project.cleanup();
		});
	});

	describe("installToKitsDir", () => {
		it("creates .hyper/kits if missing", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			await (cmd as any).installToKitsDir(
				{ type: "github", source: "github:user/repo", original: "user/repo" },
				{ dev: false, name: undefined, force: false, cwd: project.root, debug: false },
			);

			expect(existsSync(project.kitsDir)).toBe(true);

			project.cleanup();
		});

		it("errors when kit exists without --force", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			createKitDir(project.root, "repo");

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			await expect(
				(cmd as any).installToKitsDir(
					{ type: "github", source: "github:user/repo", original: "user/repo" },
					{ dev: false, name: undefined, force: false, cwd: project.root, debug: false },
				),
			).rejects.toThrow("already exists");

			project.cleanup();
		});

		it("removes existing kit with --force", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const kitDir = createKitDir(project.root, "repo");
			writeFileSync(join(kitDir, "old-file.txt"), "old content");

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			await (cmd as any).installToKitsDir(
				{ type: "github", source: "github:user/repo", original: "user/repo" },
				{ dev: false, name: undefined, force: true, cwd: project.root, debug: false },
			);

			expect(existsSync(join(kitDir, "old-file.txt"))).toBe(false);

			project.cleanup();
		});

		it("uses --name flag for custom name", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			await (cmd as any).installToKitsDir(
				{ type: "github", source: "github:user/repo", original: "user/repo" },
				{ dev: false, name: "custom-name", force: false, cwd: project.root, debug: false },
			);

			expect(existsSync(join(project.kitsDir, "custom-name"))).toBe(true);

			project.cleanup();
		});

		it("installs kits relative to resolved cwd (project root)", async () => {
			const project = createMonorepoProject("npm");

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			// resolveEffectiveCwd resolves cwd before installToKitsDir is called,
			// so installToKitsDir receives the already-resolved project root
			await (cmd as any).installToKitsDir(
				{ type: "github", source: "github:user/repo", original: "user/repo" },
				{ dev: false, name: undefined, force: false, cwd: project.root, debug: false },
			);

			expect(existsSync(join(project.root, ".hyper", "kits", "repo"))).toBe(true);

			project.cleanup();
		});

		it("adds entry to manifest after install", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			await (cmd as any).installToKitsDir(
				{ type: "github", source: "github:user/repo", original: "user/repo" },
				{ dev: false, name: undefined, force: false, cwd: project.root, debug: false },
			);

			const manifest = loadManifest(project.root);
			expect(manifest.kits.repo).toBeDefined();
			expect(manifest.kits.repo.source).toBe("user/repo");
			expect(manifest.kits.repo.type).toBe("github");

			project.cleanup();
		});
	});

	describe("copyFromLocal", () => {
		it("copies directory recursively", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const sourceDir = join(project.root, "source-kit");
			mkdirSync(sourceDir, { recursive: true });
			writeFileSync(join(sourceDir, "file.txt"), "content");
			writeFileSync(
				join(sourceDir, "package.json"),
				JSON.stringify({ name: "source-kit", version: "1.0.0" }),
			);

			const cmd = new KitInstall(["./source-kit"], { cwd: project.root } as any);
			await cmd.init();

			const targetDir = join(project.root, ".hyper", "kits", "source-kit");
			await (cmd as any).copyFromLocal(sourceDir, targetDir);

			expect(existsSync(join(targetDir, "file.txt"))).toBe(true);
			expect(readFileSync(join(targetDir, "file.txt"), "utf-8")).toBe("content");

			project.cleanup();
		});

		it("filters out node_modules, .git, dist", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });
			const sourceDir = join(project.root, "source-kit");
			mkdirSync(join(sourceDir, "node_modules"), { recursive: true });
			mkdirSync(join(sourceDir, ".git"), { recursive: true });
			mkdirSync(join(sourceDir, "dist"), { recursive: true });
			mkdirSync(join(sourceDir, "src"), { recursive: true });
			writeFileSync(join(sourceDir, "src", "index.ts"), "export {}");

			const cmd = new KitInstall(["./source-kit"], { cwd: project.root } as any);
			await cmd.init();

			const targetDir = join(project.root, ".hyper", "kits", "source-kit");
			await (cmd as any).copyFromLocal(sourceDir, targetDir);

			expect(existsSync(join(targetDir, "node_modules"))).toBe(false);
			expect(existsSync(join(targetDir, ".git"))).toBe(false);
			expect(existsSync(join(targetDir, "dist"))).toBe(false);
			expect(existsSync(join(targetDir, "src", "index.ts"))).toBe(true);

			project.cleanup();
		});

		it("errors on missing source path", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["./nonexistent"], { cwd: project.root } as any);
			await cmd.init();

			const targetDir = join(project.root, ".hyper", "kits", "test");
			await expect((cmd as any).copyFromLocal("/nonexistent/path", targetDir)).rejects.toThrow(
				"does not exist",
			);

			project.cleanup();
		});
	});

	describe("cloneFromGitHost", () => {
		it("extracts branch from #branch", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["github:user/repo#develop"], { cwd: project.root } as any);
			await cmd.init();

			const targetDir = join(project.root, ".hyper", "kits", "repo");
			const result = await (cmd as any).cloneFromGitHost(
				{ type: "github", source: "github:user/repo#develop", original: "user/repo#develop" },
				targetDir,
			);

			expect(result.branch).toBe("develop");
			expect(mockDownloadTemplate).toHaveBeenCalledWith(
				"github:user/repo#develop",
				expect.objectContaining({ dir: targetDir }),
			);

			project.cleanup();
		});

		it("extracts tag from @tag", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["github:user/repo@v1.0.0"], { cwd: project.root } as any);
			await cmd.init();

			const targetDir = join(project.root, ".hyper", "kits", "repo");
			const result = await (cmd as any).cloneFromGitHost(
				{ type: "github", source: "github:user/repo@v1.0.0", original: "user/repo@v1.0.0" },
				targetDir,
			);

			expect(result.tag).toBe("v1.0.0");

			project.cleanup();
		});

		it("wraps giget errors", async () => {
			mockDownloadTemplate.mockRejectedValueOnce(new Error("Network error"));

			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["github:user/repo"], { cwd: project.root } as any);
			await cmd.init();

			const targetDir = join(project.root, ".hyper", "kits", "repo");
			await expect(
				(cmd as any).cloneFromGitHost(
					{ type: "github", source: "github:user/repo", original: "user/repo" },
					targetDir,
				),
			).rejects.toThrow("Failed to download from git host");

			project.cleanup();
		});
	});

	describe("detectPackageManager", () => {
		it("walks up directory tree for lockfiles", async () => {
			const project = createTempProject({
				packageJson: { name: "test" },
				lockfile: "pnpm",
			});
			const nestedDir = join(project.root, "packages", "app", "src");
			mkdirSync(nestedDir, { recursive: true });

			const cmd = new KitInstall(["@hypergen/kit"], { cwd: nestedDir } as any);
			await cmd.init();
			// Set flags manually for testing
			(cmd as any).flags = { cwd: nestedDir, debug: false };

			const result = (cmd as any).detectPackageManager();

			expect(result).toBe("pnpm");

			project.cleanup();
		});

		it("falls back to checking available commands", async () => {
			const project = createTempProject({ packageJson: { name: "test" } });

			const cmd = new KitInstall(["@hypergen/kit"], { cwd: project.root } as any);
			await cmd.init();
			// Set flags manually for testing
			(cmd as any).flags = { cwd: project.root, debug: false };

			// This will try to exec bun, pnpm, yarn, then default to npm
			const result = (cmd as any).detectPackageManager();

			// On this system, bun is available, so it should return bun
			// If bun weren't available, it would try pnpm, yarn, then npm
			expect(["bun", "pnpm", "yarn", "npm"]).toContain(result);

			project.cleanup();
		});
	});
});
