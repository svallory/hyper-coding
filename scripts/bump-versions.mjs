#!/usr/bin/env node
// Bump version in all @hypercli/* package.json files and rewrite workspace:*
// references to real semver ranges. Called before publishing.
//
// Also regenerates oclif manifests for packages that use oclif, so the
// manifest version stays in sync with the bumped package.json version.
//
// Usage: node scripts/bump-versions.mjs <version>

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const version = process.argv[2];
if (!version) {
	console.error("Usage: bump-versions.mjs <version>");
	process.exit(1);
}

const packages = ["ui", "core", "kit", "hq", "gen", "cli", "create-hyper-hq"];
const root = new URL("..", import.meta.url).pathname;
const oclifPackages = [];

for (const pkg of packages) {
	const pkgPath = resolve(root, `packages/${pkg}/package.json`);
	const json = JSON.parse(readFileSync(pkgPath, "utf-8"));

	json.version = version;

	// Rewrite workspace:* references in dependencies to ^version
	for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
		const deps = json[depField];
		if (!deps) continue;
		for (const [name, value] of Object.entries(deps)) {
			if (value.startsWith("workspace:")) {
				deps[name] = `^${version}`;
			}
		}
	}

	writeFileSync(pkgPath, JSON.stringify(json, null, "\t") + "\n");
	console.log(`${json.name} → ${version}`);

	if (json.oclif) {
		oclifPackages.push(pkg);
	}
}

// Regenerate oclif manifests so the embedded version matches
if (oclifPackages.length > 0) {
	console.log("\nRegenerating oclif manifests...");
	for (const pkg of oclifPackages) {
		const pkgDir = resolve(root, `packages/${pkg}`);
		try {
			execSync("bunx oclif manifest", { cwd: pkgDir, stdio: "pipe" });
			console.log(`  ${pkg} ✓`);
		} catch (err) {
			console.error(`  ${pkg} ✗ — ${err.message}`);
		}
	}
}
