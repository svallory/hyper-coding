/**
 * Tests for findProjectRoot utility with monorepo detection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot, getKitsDirectory } from "#/utils/find-project-root";

describe("findProjectRoot", () => {
	let testDir: string;

	beforeEach(() => {
		// Create a unique temp directory for each test
		testDir = join(tmpdir(), `hypergen-root-test-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up
		if (testDir) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("should find simple project root", () => {
		// Create package.json in root
		writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test-project" }));

		const result = findProjectRoot(testDir);

		expect(result.root).toBe(testDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(false);
	});

	it("should find project root from subdirectory", () => {
		// Create package.json in root
		writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test-project" }));

		// Create subdirectory
		const subDir = join(testDir, "src", "components");
		mkdirSync(subDir, { recursive: true });

		const result = findProjectRoot(subDir);

		expect(result.root).toBe(testDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(false);
	});

	it("should detect npm workspaces monorepo", () => {
		// Create monorepo root with workspaces
		writeFileSync(
			join(testDir, "package.json"),
			JSON.stringify({
				name: "monorepo-root",
				workspaces: ["packages/*", "apps/*"],
			}),
		);

		const result = findProjectRoot(testDir);

		expect(result.root).toBe(testDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(true);
	});

	it("should find workspace root from workspace package", () => {
		// Create monorepo root
		writeFileSync(
			join(testDir, "package.json"),
			JSON.stringify({
				name: "monorepo-root",
				workspaces: ["packages/*"],
			}),
		);

		// Create workspace package
		const packageDir = join(testDir, "packages", "my-package");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "my-package" }));

		// Search from inside the workspace package
		const result = findProjectRoot(packageDir);

		expect(result.root).toBe(packageDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(true);
	});

	it("should find workspace root from nested subdirectory", () => {
		// Create monorepo root
		writeFileSync(
			join(testDir, "package.json"),
			JSON.stringify({
				name: "monorepo-root",
				workspaces: ["packages/*"],
			}),
		);

		// Create workspace package
		const packageDir = join(testDir, "packages", "my-package");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "my-package" }));

		// Create nested subdirectory
		const nestedDir = join(packageDir, "src", "components", "ui");
		mkdirSync(nestedDir, { recursive: true });

		// Search from deep inside the workspace package
		const result = findProjectRoot(nestedDir);

		expect(result.root).toBe(packageDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(true);
	});

	it("should detect pnpm workspace", () => {
		// Create monorepo root with pnpm-workspace.yaml
		writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "monorepo-root" }));
		writeFileSync(join(testDir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"');

		const result = findProjectRoot(testDir);

		expect(result.root).toBe(testDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(true);
	});

	it("should handle missing package.json gracefully", () => {
		const result = findProjectRoot(testDir);

		expect(result.root).toBe(testDir);
		expect(result.workspaceRoot).toBe(testDir);
		expect(result.isMonorepo).toBe(false);
	});
});

describe("getKitsDirectory", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `hypergen-kits-test-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (testDir) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("should return .hyper/kits in simple project", () => {
		writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test-project" }));

		const kitsDir = getKitsDirectory(testDir);

		expect(kitsDir).toBe(join(testDir, ".hyper", "kits"));
	});

	it("should return .hyper/kits at workspace root in monorepo", () => {
		// Create monorepo root
		writeFileSync(
			join(testDir, "package.json"),
			JSON.stringify({
				name: "monorepo-root",
				workspaces: ["packages/*"],
			}),
		);

		// Create workspace package
		const packageDir = join(testDir, "packages", "my-package");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "my-package" }));

		// Get kits directory from workspace package
		const kitsDir = getKitsDirectory(packageDir);

		// Should be at workspace root, not package root
		expect(kitsDir).toBe(join(testDir, ".hyper", "kits"));
	});
});
