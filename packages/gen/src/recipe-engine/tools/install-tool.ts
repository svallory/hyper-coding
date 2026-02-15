/**
 * Install Tool Implementation for Recipe Step System
 *
 * Installs packages using the project's package manager.
 * Auto-detects bun/pnpm/yarn/npm from lockfiles.
 */

import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import createDebug from "debug";
import type {
	InstallExecutionResult,
	InstallStep,
	StepContext,
	StepExecutionOptions,
	StepResult,
} from "#/recipe-engine/types";
import { Tool, type ToolValidationResult } from "./base.js";

const execAsync = promisify(exec);
const debug = createDebug("hypergen:v8:recipe:tool:install");

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/**
 * Detect the project's package manager from lockfiles
 */
function detectPackageManager(projectRoot: string): PackageManager {
	const lockfiles: Array<[string, PackageManager]> = [
		["bun.lockb", "bun"],
		["bun.lock", "bun"],
		["pnpm-lock.yaml", "pnpm"],
		["yarn.lock", "yarn"],
		["package-lock.json", "npm"],
	];

	for (const [file, pm] of lockfiles) {
		if (fs.existsSync(path.join(projectRoot, file))) {
			return pm;
		}
	}

	// Default to npm
	return "npm";
}

/**
 * Build the install command for a package manager
 */
function buildInstallCommand(pm: PackageManager, packages: string[], dev: boolean): string {
	const pkgList = packages.join(" ");

	switch (pm) {
		case "bun":
			return `bun add ${dev ? "--dev " : ""}${pkgList}`;
		case "pnpm":
			return `pnpm add ${dev ? "--save-dev " : ""}${pkgList}`;
		case "yarn":
			return `yarn add ${dev ? "--dev " : ""}${pkgList}`;
		case "npm":
			return `npm install ${dev ? "--save-dev " : ""}${pkgList}`;
	}
}

export class InstallTool extends Tool<InstallStep> {
	constructor(name = "install-tool", options: Record<string, any> = {}) {
		super("install", name, options);
	}

	protected async onValidate(
		step: InstallStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		if (!step.packages || !Array.isArray(step.packages) || step.packages.length === 0) {
			errors.push("At least one package is required");
		}

		if (step.packages) {
			for (const pkg of step.packages) {
				if (typeof pkg !== "string" || pkg.trim() === "") {
					errors.push(`Invalid package name: ${pkg}`);
				}
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: 10000,
			resourceRequirements: {
				memory: 50 * 1024 * 1024,
				disk: 100 * 1024 * 1024,
				network: true,
				processes: 1,
			},
		};
	}

	protected async onExecute(
		step: InstallStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Installing packages: %o", step.packages);

		try {
			const pm = step.packageManager || detectPackageManager(context.projectRoot);
			const dev = step.dev || false;
			const command = buildInstallCommand(pm, step.packages, dev);

			this.debug("Using %s: %s", pm, command);

			if (options?.dryRun || context.dryRun) {
				const endTime = new Date();
				return {
					status: "completed",
					stepName: step.name,
					toolType: "install",
					startTime,
					endTime,
					duration: endTime.getTime() - startTime.getTime(),
					retryCount: 0,
					dependenciesSatisfied: true,
					toolResult: {
						packageManager: pm,
						packages: step.packages,
						dev,
						dryRun: true,
						command,
					} satisfies InstallExecutionResult,
					output: { command, dryRun: true },
				};
			}

			// Strip CLAUDECODE to avoid "nested session" errors inside Claude Code
			const { CLAUDECODE: _, ...cleanEnv } = process.env;
			const { stdout, stderr } = await execAsync(command, {
				cwd: context.projectRoot,
				env: { ...cleanEnv },
			});

			const endTime = new Date();
			return {
				status: "completed",
				stepName: step.name,
				toolType: "install",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: {
					packageManager: pm,
					packages: step.packages,
					dev,
					exitCode: 0,
					stdout: stdout.toString(),
					stderr: stderr.toString(),
				} satisfies InstallExecutionResult,
				output: { stdout: stdout.toString() },
			};
		} catch (error: any) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			// If optional, treat failure as completed with warning
			if (step.optional) {
				this.debug("Optional install failed (non-fatal): %s", error.message);
				return {
					status: "completed",
					stepName: step.name,
					toolType: "install",
					startTime,
					endTime,
					duration,
					retryCount: 0,
					dependenciesSatisfied: true,
					toolResult: {
						packages: step.packages,
						optional: true,
						warning: `Install failed (optional): ${error.message}`,
					} satisfies InstallExecutionResult,
					output: { warning: error.message },
				};
			}

			return {
				status: "failed",
				stepName: step.name,
				toolType: "install",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: "INSTALL_FAILED",
					cause: error,
				},
			};
		}
	}
}

export class InstallToolFactory {
	create(name = "install-tool", options: Record<string, any> = {}): InstallTool {
		return new InstallTool(name, options);
	}

	getToolType(): "install" {
		return "install";
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		return {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		};
	}
}

export const installToolFactory = new InstallToolFactory();
