import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import createDebug from "debug";

const debug = createDebug("hypergen:utils:global-packages");
const execAsync = promisify(exec);

export interface GlobalPackage {
	name: string;
	path: string;
}

/**
 * Get list of globally installed packages using the current engine's package manager.
 * - If running in Bun, queries `bun pm ls -g`
 * - Otherwise (Node), queries `npm list -g`
 */
export async function getGlobalPackages(): Promise<GlobalPackage[]> {
	const isBun = !!(process.versions as any).bun;

	if (isBun) {
		return getBunGlobalPackages();
	} else {
		return getNpmGlobalPackages();
	}
}

async function getNpmGlobalPackages(): Promise<GlobalPackage[]> {
	try {
		// Get the global root first, as npm list json doesn't always include full paths for top level
		const { stdout: rootStdout } = await execAsync("npm root -g");
		const globalRoot = rootStdout.trim();

		// Get the list in JSON format
		const { stdout: listStdout } = await execAsync("npm list -g --depth=0 --json");
		const list = JSON.parse(listStdout);

		if (!list.dependencies) return [];

		return Object.keys(list.dependencies).map((name) => ({
			name,
			path: path.join(globalRoot, name),
		}));
	} catch (error) {
		debug("Failed to get npm global packages: %s", error);
		return [];
	}
}

async function getBunGlobalPackages(): Promise<GlobalPackage[]> {
	try {
		// Bun doesn't output JSON for ls yet, need to parse text
		// Output format:
		// /path/to/global/install node_modules (count)
		// ├── package@version
		// └── package@version

		const { stdout } = await execAsync("bun pm ls -g");
		const lines = stdout.split("\n");

		if (lines.length === 0) return [];

		// First line contains the root.
		// Example: "/Users/user/.cache/.bun/install/global node_modules (1478)"
		// We want the path part before " node_modules".
		const firstLine = lines[0];
		// Split by " node_modules" -> ["/Users/.../global", " (1478)"]
		const rootPathPart = firstLine.split(" node_modules")[0];

		// Based on `bun pm bin -g` vs `ls` observation, the packages are inside `node_modules` in that root
		const globalRoot = path.join(rootPathPart.trim(), "node_modules");

		const packages: GlobalPackage[] = [];

		// Parse subsequent lines
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			// Lines start with ├── or └── depending on position
			// remove tree characters
			const cleanLine = line.replace(/^[└├]──\s*/, "");

			// Format: name@version OR @scope/name@version
			// We need to split name and version. Last @ is version separator.
			const lastAtIndex = cleanLine.lastIndexOf("@");
			if (lastAtIndex === -1) continue; // Should not happen for valid output

			const name = cleanLine.substring(0, lastAtIndex);

			// Basic validation to avoid junk
			if (name) {
				packages.push({
					name,
					path: path.join(globalRoot, name),
				});
			}
		}

		return packages;
	} catch (error) {
		debug("Failed to get bun global packages: %s", error);
		return [];
	}
}
