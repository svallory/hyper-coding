/**
 * Kit Manifest Management
 *
 * Tracks installed kits in .hyper/kits/manifest.json with version/commit information
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KitSourceType } from "#/source-resolver.js";

/**
 * Individual kit entry in the manifest
 *
 * @example
 * ```json
 * {
 *   "name": "nextjs",
 *   "source": "kit/nextjs#main",
 *   "type": "github",
 *   "installedAt": "2026-02-13T14:30:00.000Z",
 *   "branch": "main",
 *   "version": "1.2.0"
 * }
 * ```
 */
export interface KitManifestEntry {
	/** Kit name (directory name in .hyper/kits/) */
	name: string;

	/** Original source string provided by user */
	source: string;

	/** Source type - determines installation method */
	type: KitSourceType;

	/** Installation timestamp in ISO 8601 format */
	installedAt: string;

	/** Git commit hash (40-char SHA-1, for git-based sources) */
	commit?: string;

	/** Semantic version from package.json or npm/JSR */
	version?: string;

	/** Git branch name (for git-based sources installed from branch) */
	branch?: string;

	/** Git tag name (for git-based sources installed from tag) */
	tag?: string;
}

/**
 * Root manifest structure
 *
 * @example
 * ```json
 * {
 *   "version": "1.0.0",
 *   "kits": {
 *     "nextjs": { ... },
 *     "react": { ... }
 *   }
 * }
 * ```
 */
export interface KitManifest {
	/** Manifest schema version (semver) */
	version: string;

	/** Map of kit name to manifest entry */
	kits: Record<string, KitManifestEntry>;
}

const MANIFEST_VERSION = "1.0.0";

/**
 * Get the path to the manifest file
 */
export function getManifestPath(projectRoot: string): string {
	return join(projectRoot, ".hyper", "kits", "manifest.json");
}

/**
 * Load the manifest file, or create a new one if it doesn't exist
 */
export function loadManifest(projectRoot: string): KitManifest {
	const manifestPath = getManifestPath(projectRoot);

	if (!existsSync(manifestPath)) {
		return {
			version: MANIFEST_VERSION,
			kits: {},
		};
	}

	try {
		const content = readFileSync(manifestPath, "utf-8");
		return JSON.parse(content);
	} catch (error) {
		// If manifest is corrupted, return empty manifest
		console.warn("Warning: Failed to read manifest.json, creating new one");
		return {
			version: MANIFEST_VERSION,
			kits: {},
		};
	}
}

/**
 * Save the manifest file
 */
export function saveManifest(projectRoot: string, manifest: KitManifest): void {
	const manifestPath = getManifestPath(projectRoot);
	const manifestDir = dirname(manifestPath);

	// Ensure .hyper/kits directory exists
	if (!existsSync(manifestDir)) {
		mkdirSync(manifestDir, { recursive: true });
	}

	// Write manifest with pretty formatting
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Add or update a kit in the manifest
 */
export function addKitToManifest(
	projectRoot: string,
	entry: KitManifestEntry,
): void {
	const manifest = loadManifest(projectRoot);
	manifest.kits[entry.name] = entry;
	saveManifest(projectRoot, manifest);
}

/**
 * Remove a kit from the manifest
 */
export function removeKitFromManifest(
	projectRoot: string,
	kitName: string,
): void {
	const manifest = loadManifest(projectRoot);
	delete manifest.kits[kitName];
	saveManifest(projectRoot, manifest);
}

/**
 * Check if a kit is already installed
 */
export function isKitInstalled(projectRoot: string, kitName: string): boolean {
	const manifest = loadManifest(projectRoot);
	return kitName in manifest.kits;
}

/**
 * Get a kit entry from the manifest
 */
export function getKitFromManifest(
	projectRoot: string,
	kitName: string,
): KitManifestEntry | undefined {
	const manifest = loadManifest(projectRoot);
	return manifest.kits[kitName];
}

/**
 * List all installed kits
 */
export function listInstalledKits(projectRoot: string): KitManifestEntry[] {
	const manifest = loadManifest(projectRoot);
	return Object.values(manifest.kits);
}

/**
 * Extract version/commit information from tiged result
 * Tiged doesn't provide this directly, so we'll need to get it from the downloaded files
 */
export async function extractGitInfo(
	kitDir: string,
): Promise<{ commit?: string; branch?: string; tag?: string }> {
	// For now, we can't reliably get commit info without .git directory
	// Future enhancement: tiged could be modified to save this info
	return {};
}

/**
 * Extract version from package.json if it exists
 */
export function extractPackageVersion(kitDir: string): string | undefined {
	const packageJsonPath = join(kitDir, "package.json");

	if (!existsSync(packageJsonPath)) {
		return undefined;
	}

	try {
		const content = readFileSync(packageJsonPath, "utf-8");
		const pkg = JSON.parse(content);
		return pkg.version;
	} catch {
		return undefined;
	}
}
