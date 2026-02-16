/**
 * Tests for project root detection with monorepo support
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findProjectRoot, getKitsDirectory } from "../../src/utils/find-project-root.js";
import { createMonorepoProject, createTempProject } from "../helpers/temp-project.js";

describe("findProjectRoot", () => {
	describe("no package.json", () => {
		it("returns startDir as root when no package.json found", () => {
			const project = createTempProject();
			const isolatedDir = join(project.root, "isolated", "path");

			const result = findProjectRoot(isolatedDir);

			expect(result.root).toBe(isolatedDir);
			expect(result.isMonorepo).toBe(false);
			expect(result.workspaceRoot).toBe(isolatedDir);
			expect(result.packageJsonPath).toBe(isolatedDir);

			project.cleanup();
		});
	});

	describe("simple project", () => {
		it("finds package.json and returns its directory as root", () => {
			const project = createTempProject({
				packageJson: { name: "test-project", version: "1.0.0" },
			});

			const result = findProjectRoot(project.root);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(false);
			expect(result.workspaceRoot).toBe(project.root);
			expect(result.packageJsonPath).toBe(join(project.root, "package.json"));

			project.cleanup();
		});
	});

	describe("nested directory", () => {
		it("walks up to find nearest package.json", () => {
			const project = createTempProject({
				packageJson: { name: "test-project", version: "1.0.0" },
			});

			const result = findProjectRoot(project.nestedDir);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(false);

			project.cleanup();
		});
	});

	describe("monorepo detection - npm workspaces", () => {
		it("detects npm workspaces as monorepo root", () => {
			const project = createMonorepoProject("npm");

			const result = findProjectRoot(project.root);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});

		it("finds workspace root from within a workspace package", () => {
			const project = createMonorepoProject("npm");
			const workspacePackageDir = join(project.root, "packages", "app");

			const result = findProjectRoot(workspacePackageDir);

			expect(result.root).toBe(workspacePackageDir);
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});

		it("finds workspace root from deep within a workspace package", () => {
			const project = createMonorepoProject("npm");

			const result = findProjectRoot(project.nestedDir);

			expect(result.root).toBe(join(project.root, "packages", "app"));
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});
	});

	describe("monorepo detection - pnpm", () => {
		it("detects pnpm-workspace.yaml as monorepo root", () => {
			const project = createMonorepoProject("pnpm");

			const result = findProjectRoot(project.root);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});

		it("finds pnpm workspace root from within a package", () => {
			const project = createMonorepoProject("pnpm");
			const workspacePackageDir = join(project.root, "packages", "app");

			const result = findProjectRoot(workspacePackageDir);

			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});
	});

	describe("monorepo detection - lerna", () => {
		it("detects lerna.json as monorepo root", () => {
			const project = createMonorepoProject("lerna");

			const result = findProjectRoot(project.root);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});
	});

	describe("monorepo detection - bolt", () => {
		it("detects bolt.workspaces as monorepo root", () => {
			const project = createMonorepoProject("bolt");

			const result = findProjectRoot(project.root);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});
	});

	describe("monorepo detection - yarn", () => {
		it("detects yarn workspaces as monorepo root", () => {
			const project = createMonorepoProject("yarn");

			const result = findProjectRoot(project.root);

			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(true);
			expect(result.workspaceRoot).toBe(project.root);

			project.cleanup();
		});
	});

	describe("invalid JSON handling", () => {
		it("handles corrupted package.json gracefully", () => {
			const project = createTempProject();
			writeFileSync(join(project.root, "package.json"), "{invalid json");

			const result = findProjectRoot(project.root);

			// Should fall back to treating startDir as root
			expect(result.root).toBe(project.root);
			expect(result.isMonorepo).toBe(false);

			project.cleanup();
		});
	});
});

describe("getKitsDirectory", () => {
	it("returns .hyper/kits at project root for simple project", () => {
		const project = createTempProject({
			packageJson: { name: "test", version: "1.0.0" },
		});

		const result = getKitsDirectory(project.root);

		expect(result).toBe(join(project.root, ".hyper", "kits"));

		project.cleanup();
	});

	it("uses workspace root in monorepo", () => {
		const project = createMonorepoProject("npm");
		const workspacePackageDir = join(project.root, "packages", "app");

		const result = getKitsDirectory(workspacePackageDir);

		expect(result).toBe(join(project.root, ".hyper", "kits"));

		project.cleanup();
	});

	it("uses workspace root from deep nested path in monorepo", () => {
		const project = createMonorepoProject("pnpm");

		const result = getKitsDirectory(project.nestedDir);

		expect(result).toBe(join(project.root, ".hyper", "kits"));

		project.cleanup();
	});
});
