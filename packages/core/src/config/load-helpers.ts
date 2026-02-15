/**
 * Shared helper loading utility
 *
 * Loads helper functions from a file path, directory, or plain object.
 * Used by HypergenConfigLoader, kit-parser, and cookbook-parser.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Load helpers from a file path, directory, or object.
 * Resolves relative paths against baseDir.
 * Returns Record<string, Function>.
 */
export async function loadHelpers(
	helpers: string | Record<string, Function> | undefined,
	baseDir: string,
): Promise<Record<string, Function>> {
	if (!helpers) return {};

	if (typeof helpers === "string") {
		// Load helpers from file or directory
		let helpersPath = path.isAbsolute(helpers)
			? helpers
			: path.resolve(baseDir, helpers);

		try {
			// Check if path is a directory
			if (fs.existsSync(helpersPath)) {
				const stats = fs.statSync(helpersPath);
				if (stats.isDirectory()) {
					// Try index.ts, index.js, index.mjs, index.cjs
					const indexFiles = ["index.ts", "index.js", "index.mjs", "index.cjs"];
					let found = false;
					for (const indexFile of indexFiles) {
						const indexPath = path.join(helpersPath, indexFile);
						if (fs.existsSync(indexPath)) {
							helpersPath = indexPath;
							found = true;
							break;
						}
					}
					if (!found) {
						console.warn(
							`Warning: Could not find index file in helpers directory ${helpersPath}`,
						);
						return {};
					}
				}
			}

			// Check if the resolved file exists
			if (!fs.existsSync(helpersPath)) {
				console.warn(
					`Warning: Could not load helpers from ${helpersPath} (file not found)`,
				);
				return {};
			}

			const fileUrl = pathToFileURL(helpersPath).href;
			const module = await import(fileUrl);
			const loaded = module.default || module;
			// Ensure we return a plain object with own properties
			// to avoid prototype chain issues when spreading
			return { ...loaded };
		} catch (error) {
			console.warn(`Warning: Could not load helpers from ${helpersPath}`);
			console.warn(
				`  Error: ${error instanceof Error ? error.message : String(error)}`,
			);
			return {};
		}
	} else if (typeof helpers === "object") {
		// Use provided helpers object
		return helpers;
	}

	return {};
}
