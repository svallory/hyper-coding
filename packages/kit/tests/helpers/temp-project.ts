/**
 * Test helper for creating temporary project structures
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KitManifest, KitManifestEntry } from "#manifest";

export interface TempProjectOptions {
	/** package.json content (will be JSON.stringified) */
	packageJson?: Record<string, unknown>;
	/** Which lockfile to create */
	lockfile?: "bun" | "pnpm" | "yarn" | "npm";
	/** Initial manifest content */
	manifest?: KitManifest;
	/** Additional files to create: path -> content */
	files?: Record<string, string>;
	/** Create pnpm-workspace.yaml */
	pnpmWorkspace?: boolean;
	/** Create lerna.json */
	lerna?: boolean;
}

export interface TempProjectResult {
	/** Root directory of the temp project */
	root: string;
	/** Cleanup function to remove the temp directory */
	cleanup: () => void;
	/** Path to a subdirectory (for testing nested scenarios) */
	nestedDir: string;
	/** Path to .hyper/kits directory */
	kitsDir: string;
	/** Path to manifest.json */
	manifestPath: string;
}

/**
 * Create a temporary project structure for testing
 */
export function createTempProject(options: TempProjectOptions = {}): TempProjectResult {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	const root = join(tmpdir(), `hyper-kit-test-${timestamp}-${random}`);

	// Create root directory
	mkdirSync(root, { recursive: true });

	// Create package.json if provided
	if (options.packageJson) {
		writeFileSync(join(root, "package.json"), JSON.stringify(options.packageJson, null, 2));
	}

	// Create lockfile if specified
	if (options.lockfile) {
		const lockfiles = {
			bun: "bun.lockb",
			pnpm: "pnpm-lock.yaml",
			yarn: "yarn.lock",
			npm: "package-lock.json",
		};
		writeFileSync(join(root, lockfiles[options.lockfile]), "");
	}

	// Create pnpm-workspace.yaml
	if (options.pnpmWorkspace) {
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
	}

	// Create lerna.json
	if (options.lerna) {
		writeFileSync(
			join(root, "lerna.json"),
			JSON.stringify({ version: "1.0.0", packages: ["packages/*"] }, null, 2),
		);
	}

	// Create additional files
	if (options.files) {
		for (const [filePath, content] of Object.entries(options.files)) {
			const fullPath = join(root, filePath);
			const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
			if (dir && !existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(fullPath, content);
		}
	}

	// Create manifest if provided
	const kitsDir = join(root, ".hyper", "kits");
	const manifestPath = join(kitsDir, "manifest.json");
	if (options.manifest) {
		mkdirSync(kitsDir, { recursive: true });
		writeFileSync(manifestPath, JSON.stringify(options.manifest, null, 2));
	}

	// Create a nested directory for testing path walking
	const nestedDir = join(root, "packages", "app", "src");
	mkdirSync(nestedDir, { recursive: true });

	return {
		root,
		cleanup: () => {
			rmSync(root, { recursive: true, force: true });
		},
		nestedDir,
		kitsDir,
		manifestPath,
	};
}

/**
 * Create a monorepo structure with workspace packages
 */
export function createMonorepoProject(
	workspaceType: "npm" | "pnpm" | "yarn" | "lerna" | "bolt" = "npm",
): TempProjectResult {
	const rootPackageJson: Record<string, unknown> = {
		name: "test-monorepo",
		version: "1.0.0",
		private: true,
	};

	// Add workspace configuration based on type
	if (workspaceType === "npm" || workspaceType === "yarn") {
		rootPackageJson.workspaces = ["packages/*"];
	} else if (workspaceType === "bolt") {
		rootPackageJson.bolt = { workspaces: ["packages/*"] };
	}

	const project = createTempProject({
		packageJson: rootPackageJson,
		pnpmWorkspace: workspaceType === "pnpm",
		lerna: workspaceType === "lerna",
	});

	// Create a workspace package
	const workspacePackageDir = join(project.root, "packages", "app");
	mkdirSync(workspacePackageDir, { recursive: true });
	writeFileSync(
		join(workspacePackageDir, "package.json"),
		JSON.stringify({ name: "@test/app", version: "1.0.0" }, null, 2),
	);

	// Create a nested directory inside the workspace package
	const nestedDir = join(workspacePackageDir, "src", "components");
	mkdirSync(nestedDir, { recursive: true });

	return {
		...project,
		nestedDir,
	};
}

/**
 * Create a kit directory with optional package.json
 */
export function createKitDir(
	projectRoot: string,
	kitName: string,
	options?: {
		version?: string;
		additionalFiles?: Record<string, string>;
	},
): string {
	const kitDir = join(projectRoot, ".hyper", "kits", kitName);
	mkdirSync(kitDir, { recursive: true });

	if (options?.version) {
		writeFileSync(
			join(kitDir, "package.json"),
			JSON.stringify({ name: kitName, version: options.version }, null, 2),
		);
	}

	if (options?.additionalFiles) {
		for (const [filePath, content] of Object.entries(options.additionalFiles)) {
			const fullPath = join(kitDir, filePath);
			const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
			if (dir && !existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(fullPath, content);
		}
	}

	return kitDir;
}

/**
 * Create a manifest entry for testing
 */
export function createManifestEntry(overrides: Partial<KitManifestEntry> = {}): KitManifestEntry {
	return {
		name: "test-kit",
		source: "github:user/test-kit",
		type: "github",
		installedAt: new Date().toISOString(),
		...overrides,
	};
}
