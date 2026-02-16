#!/usr/bin/env bun
/**
 * Updates package.json `imports` field for each package under packages/.
 *
 * For each folder under src/, adds:
 *   "#<folder>":   "./dist/<folder>/index.js"  (if index.ts exists)
 *   "#<folder>/*": "./dist/<folder>/*.js"
 *
 * Test-related imports (with .ts extension):
 *   "#tests/*":    "./tests/*.ts"
 *   "#fixtures/*": "./tests/fixtures/*.ts"
 *   "#helpers/*":  "./tests/helpers/*.ts"
 *
 * Catch-all:
 *   "#*": "./dist/*.js"
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = join(import.meta.dirname, "..", "packages");

const packages = readdirSync(PACKAGES_DIR).filter((name) => {
	const pkgJson = join(PACKAGES_DIR, name, "package.json");
	return existsSync(pkgJson);
});

for (const pkg of packages) {
	const pkgDir = join(PACKAGES_DIR, pkg);
	const srcDir = join(pkgDir, "src");
	const pkgJsonPath = join(pkgDir, "package.json");

	if (!existsSync(srcDir)) {
		console.log(`Skipping ${pkg}: no src/ directory`);
		continue;
	}

	const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
	const imports: Record<string, string> = {};

	const entries = readdirSync(srcDir);

	// Folders: 2 entries each
	for (const entry of entries) {
		const fullPath = join(srcDir, entry);
		if (!statSync(fullPath).isDirectory()) continue;

		// Barrel import: #folder -> ./dist/folder/index.js (only if index.ts exists)
		if (existsSync(join(fullPath, "index.ts"))) {
			imports[`#${entry}`] = `./dist/${entry}/index.js`;
		}
		// Wildcard: #folder/* -> ./dist/folder/*.js
		imports[`#${entry}/*`] = `./dist/${entry}/*.js`;
	}

	// Test-related imports (ts extension)
	imports["#tests/*"] = "./tests/*.ts";
	imports["#fixtures/*"] = "./tests/fixtures/*.ts";
	imports["#helpers/*"] = "./tests/helpers/*.ts";

	// Catch-all for top-level files and anything else
	imports["#*"] = "./dist/*.js";

	pkgJson.imports = imports;

	writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, "  ")}\n`);

	console.log(`Updated ${pkg}/package.json with ${Object.keys(imports).length} import entries:`);
	for (const [key, val] of Object.entries(imports)) {
		console.log(`  ${key} -> ${val}`);
	}
	console.log();
}
