/**
 * Find the project root directory by looking for package.json
 * with monorepo detection support
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import createDebug from "debug";

const debug = createDebug("hypergen:utils:project-root");

export interface ProjectRootInfo {
	/** The project root directory */
	root: string;
	/** Whether this is a monorepo workspace */
	isMonorepo: boolean;
	/** If in a monorepo, the workspace root (otherwise same as root) */
	workspaceRoot: string;
	/** The package.json that was found */
	packageJsonPath: string;
}

/**
 * Find the nearest package.json walking up from startDir
 */
function findNearestPackageJson(startDir: string): string | null {
	let dir = startDir;

	while (dir !== "/" && dir !== ".") {
		const packageJsonPath = join(dir, "package.json");
		if (existsSync(packageJsonPath)) {
			return packageJsonPath;
		}

		const parent = join(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

/**
 * Check if a package.json indicates a monorepo root
 */
function isMonorepoRoot(packageJsonPath: string): boolean {
	try {
		const content = readFileSync(packageJsonPath, "utf-8");
		const packageJson = JSON.parse(content);

		// Check for common monorepo indicators
		return !!(
			(
				packageJson.workspaces || // npm/yarn/pnpm workspaces
				packageJson.bolt?.workspaces || // bolt
				existsSync(join(dirname(packageJsonPath), "pnpm-workspace.yaml")) || // pnpm
				existsSync(join(dirname(packageJsonPath), "lerna.json"))
			) // lerna
		);
	} catch (error) {
		debug("Error reading package.json: %s", error);
		return false;
	}
}

/**
 * Check if we're inside a monorepo workspace package
 */
function isWorkspacePackage(packageJsonPath: string): boolean {
	try {
		// Workspace packages typically don't have a "private: true" at root
		// but we need to check if there's a parent with workspaces
		const dir = dirname(packageJsonPath);
		const parentPackageJson = findNearestPackageJson(join(dir, ".."));

		if (parentPackageJson && isMonorepoRoot(parentPackageJson)) {
			debug(
				"Found workspace package at %s with monorepo root at %s",
				packageJsonPath,
				parentPackageJson,
			);
			return true;
		}

		return false;
	} catch (error) {
		debug("Error checking if workspace package: %s", error);
		return false;
	}
}

/**
 * Find the project root, with monorepo detection
 *
 * This function:
 * 1. Finds the nearest package.json from startDir
 * 2. If it's a workspace package, walks up to find the monorepo root
 * 3. Returns both the immediate project root and workspace root (if in monorepo)
 *
 * @param startDir - Directory to start searching from (defaults to process.cwd())
 * @returns Project root information
 */
export function findProjectRoot(
	startDir: string = process.cwd(),
): ProjectRootInfo {
	debug("Finding project root from: %s", startDir);

	// Find nearest package.json
	const nearestPackageJson = findNearestPackageJson(startDir);

	if (!nearestPackageJson) {
		debug("No package.json found, using startDir as root");
		return {
			root: startDir,
			isMonorepo: false,
			workspaceRoot: startDir,
			packageJsonPath: startDir,
		};
	}

	const immediateRoot = dirname(nearestPackageJson);
	debug("Found package.json at: %s", nearestPackageJson);

	// Check if this is a monorepo root
	if (isMonorepoRoot(nearestPackageJson)) {
		debug("This is a monorepo root");
		return {
			root: immediateRoot,
			isMonorepo: true,
			workspaceRoot: immediateRoot,
			packageJsonPath: nearestPackageJson,
		};
	}

	// Check if we're in a workspace package
	if (isWorkspacePackage(nearestPackageJson)) {
		// Walk up to find the monorepo root
		const workspaceRootPackageJson = findNearestPackageJson(
			join(immediateRoot, ".."),
		);

		if (workspaceRootPackageJson) {
			const workspaceRoot = dirname(workspaceRootPackageJson);
			debug("Found monorepo workspace root at: %s", workspaceRoot);

			return {
				root: immediateRoot,
				isMonorepo: true,
				workspaceRoot,
				packageJsonPath: nearestPackageJson,
			};
		}
	}

	// Not a monorepo or couldn't find workspace root
	debug("Not in a monorepo");
	return {
		root: immediateRoot,
		isMonorepo: false,
		workspaceRoot: immediateRoot,
		packageJsonPath: nearestPackageJson,
	};
}

/**
 * Get the directory where .hyper/kits should be located
 * Always uses the workspace root if in a monorepo
 */
export function getKitsDirectory(startDir: string = process.cwd()): string {
	const projectInfo = findProjectRoot(startDir);
	return join(projectInfo.workspaceRoot, ".hyper", "kits");
}
