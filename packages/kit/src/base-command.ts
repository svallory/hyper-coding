/**
 * Base command class for @hypercli/kit commands
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Flags, type Interfaces } from "@oclif/core";

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
	(typeof BaseCommand)["baseFlags"] & T["flags"]
>;
export type BaseArgs<T extends typeof Command> = Interfaces.InferredArgs<T["args"]>;

/**
 * Abstract base command that all kit management commands extend
 */
export abstract class BaseCommand<T extends typeof Command> extends Command {
	static baseFlags = {
		cwd: Flags.directory({
			description: "Working directory",
			default: process.cwd(),
		}),
		debug: Flags.boolean({
			char: "d",
			description: "Enable debug output",
			default: false,
			env: "DEBUG",
		}),
	};

	protected flags!: BaseFlags<T>;
	protected args!: BaseArgs<T>;

	/**
	 * Detect the package manager being used in the project
	 */
	protected detectPackageManager(): "bun" | "pnpm" | "yarn" | "npm" {
		const cwd = (this.flags as any).cwd || process.cwd();

		// Check for lockfiles (in order of preference)
		if (existsSync(join(cwd, "bun.lockb"))) {
			return "bun";
		}
		if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
			return "pnpm";
		}
		if (existsSync(join(cwd, "yarn.lock"))) {
			return "yarn";
		}

		// Check package.json for packageManager field
		const packageJsonPath = join(cwd, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
				if (packageJson.packageManager) {
					const pm = packageJson.packageManager.split("@")[0];
					if (pm === "bun" || pm === "pnpm" || pm === "yarn" || pm === "npm") {
						return pm;
					}
				}
			} catch {
				// Ignore parse errors
			}
		}

		// Default to npm
		return "npm";
	}
}
