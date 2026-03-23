import { spawnSync } from "node:child_process";

function getLoginShell(): string {
	return process.env["SHELL"] ?? "/bin/bash";
}

export function isToolInstalled(name: string): boolean {
	const shell = getLoginShell();
	const result = spawnSync(shell, ["-l", "-c", `which ${name}`], {
		encoding: "utf-8",
		timeout: 5000,
	});
	return result.status === 0;
}

export function getToolVersion(name: string): string | null {
	const shell = getLoginShell();
	const result = spawnSync(shell, ["-l", "-c", `${name} --version`], {
		encoding: "utf-8",
		timeout: 5000,
	});
	if (result.status !== 0) return null;
	return result.stdout.trim() || null;
}

/**
 * Extract a semver string (x.y.z) from arbitrary version output.
 * Returns null if no semver is found.
 */
export function parseSemver(output: string): string | null {
	const match = output.match(/(\d+\.\d+\.\d+)/);
	return match ? (match[1] ?? null) : null;
}

/**
 * Fetch the latest published version of an npm package.
 * Uses `npm view` directly — npm is always available when invoked via `npm create`.
 * Returns null on failure.
 */
export function getLatestNpmVersion(packageName: string): string | null {
	const result = spawnSync("npm", ["view", packageName, "version"], {
		encoding: "utf-8",
		timeout: 10000,
	});
	if (result.status !== 0) return null;
	return result.stdout.trim() || null;
}
