#!/usr/bin/env node
// Bump version in all @hypercli/* package.json files to a synchronized version.
// Called by semantic-release's prepareCmd: node scripts/bump-versions.mjs <version>

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const version = process.argv[2];
if (!version) {
	console.error("Usage: bump-versions.mjs <version>");
	process.exit(1);
}

const packages = ["ui", "core", "kit", "hq", "gen", "cli"];
const root = new URL("..", import.meta.url).pathname;

for (const pkg of packages) {
	const pkgPath = resolve(root, `packages/${pkg}/package.json`);
	const json = JSON.parse(readFileSync(pkgPath, "utf-8"));
	json.version = version;
	writeFileSync(pkgPath, JSON.stringify(json, null, "\t") + "\n");
	console.log(`@hypercli/${pkg} → ${version}`);
}
