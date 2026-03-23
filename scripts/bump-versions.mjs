#!/usr/bin/env node
// Bump version in all @hypercli/* package.json files and rewrite workspace:*
// references to real semver ranges. Called before publishing.
//
// Usage: node scripts/bump-versions.mjs <version>

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const version = process.argv[2];
if (!version) {
	console.error("Usage: bump-versions.mjs <version>");
	process.exit(1);
}

const packages = ["ui", "core", "kit", "hq", "gen", "cli"];
const scope = "@hypercli/";
const root = new URL("..", import.meta.url).pathname;

for (const pkg of packages) {
	const pkgPath = resolve(root, `packages/${pkg}/package.json`);
	const json = JSON.parse(readFileSync(pkgPath, "utf-8"));

	json.version = version;

	// Rewrite workspace:* references in dependencies to ^version
	for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
		const deps = json[depField];
		if (!deps) continue;
		for (const [name, value] of Object.entries(deps)) {
			if (name.startsWith(scope) && value.startsWith("workspace:")) {
				deps[name] = `^${version}`;
			}
		}
	}

	writeFileSync(pkgPath, JSON.stringify(json, null, "\t") + "\n");
	console.log(`@hypercli/${pkg} → ${version}`);
}
