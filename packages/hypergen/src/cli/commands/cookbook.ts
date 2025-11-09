// src/cli/commands/cookbook.ts

import fs from 'node:fs';
import path from 'node:path';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import type Logger from '../../logger.js';
import type {
	RecipeEngine,
	RecipeExecutionOptions,
} from '../../recipe-engine/recipe-engine.js';
import type { RunnerConfig } from '../../types.js';
import { parseFlags, parseParameters } from '../utils/command-parser.js';

export class CookbookCommand {
	private recipeEngine: RecipeEngine | undefined;
	private logger: Logger;
	private config: RunnerConfig;

	constructor(
		recipeEngine: RecipeEngine | undefined,
		logger: Logger,
		config: RunnerConfig,
	) {
		this.recipeEngine = recipeEngine;
		this.logger = logger;
		this.config = config;
	}

	/**
	 * Runs a recipe from the cookbook.
	 * If RECIPE is not specified, runs the default recipe if one is defined,
	 * otherwise explains the cookbook does not have a default recipe and shows
	 * the available recipes in the cookbook.
	 *
	 * Usage: hypergen cookbook [RECIPE] [--use-defaults] [...VARS]
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [recipeNameOrPath, ...paramArgs] = args;

		if (!this.recipeEngine) {
			return {
				success: false,
				message: 'RecipeEngine not initialized. Cannot run cookbook command.',
			};
		}

		// Parse flags and parameters
		const flags = parseFlags(paramArgs);
		const parameters = parseParameters(paramArgs);

		const dryRun = flags.has('dryRun');
		const force = flags.has('force');
		const skipPrompts = flags.has('skipPrompts') || flags.has('use-defaults'); // --use-defaults is an alias for --skipPrompts
		const continueOnError = flags.has('continueOnError');

		const options: RecipeExecutionOptions = {
			variables: parameters,
			workingDir: this.config.cwd || process.cwd(),
			dryRun,
			force,
			continueOnError,
			skipPrompts,
			logger: this.logger,
			onProgress: (progress) => {
				console.log(
					`📈 ${progress.step}: ${progress.phase} (${progress.percentage}%)`,
				);
			},
			onStepComplete: (result) => {
				const status =
					result.status === 'completed'
						? '✅'
						: result.status === 'failed'
							? '❌'
							: result.status === 'skipped'
								? '⏭️'
								: '⏸️';
				console.log(
					`${status} Step: ${result.stepName} (${result.duration}ms)`,
				);
			},
		};

		let recipePath: string | undefined;

		if (recipeNameOrPath) {
			// User specified a recipe name or path
			recipePath = this.resolveRecipePath(recipeNameOrPath);
			if (!recipePath) {
				return {
					success: false,
					message: `❌ Recipe '${recipeNameOrPath}' not found. Use 'hypergen cookbook' to list available recipes.`,
				};
			}
		} else {
			// No recipe specified, try to find a default recipe
			recipePath = this.findDefaultRecipe();
			if (!recipePath) {
				const availableRecipes = await this.getAvailableRecipeNames();
				let message =
					'📝 No default recipe found. Please specify a recipe to run.\n';
				if (availableRecipes.length > 0) {
					message += '\nAvailable recipes:\n';
					message += availableRecipes.map((name) => `  • ${name}`).join('\n');
				} else {
					message +=
						'\nNo recipes found. Create .yml or .yaml files in your _recipes/ directory.';
				}
				return { success: false, message };
			}
		}

		try {
			const result = await this.recipeEngine.executeRecipe(recipePath, options);

			if (result.success) {
				let message = dryRun
					? `🔍 [DRY RUN] Recipe '${result.recipe.name}' would complete successfully`
					: `✅ Recipe '${result.recipe.name}' completed successfully`;

				message += '\n\nExecution Summary:';
				message += `\n  Duration: ${result.duration}ms`;
				message += `\n  Steps completed: ${result.metadata.completedSteps}/${result.metadata.totalSteps}`;

				if (result.metadata.failedSteps > 0) {
					message += `\n  Failed steps: ${result.metadata.failedSteps}`;
				}

				if (result.metadata.skippedSteps > 0) {
					message += `\n  Skipped steps: ${result.metadata.skippedSteps}`;
				}

				if (result.filesCreated.length > 0) {
					message += dryRun
						? `\n\nFiles would be created: ${result.filesCreated.join(', ')}`
						: `\n\nFiles created: ${result.filesCreated.join(', ')}`;
				}

				if (result.filesModified.length > 0) {
					message += dryRun
						? `\nFiles would be modified: ${result.filesModified.join(', ')}`
						: `\nFiles modified: ${result.filesModified.join(', ')}`;
				}

				if (result.filesDeleted.length > 0) {
					message += dryRun
						? `\nFiles would be deleted: ${result.filesDeleted.join(', ')}`
						: `\nFiles deleted: ${result.filesDeleted.join(', ')}`;
				}

				if (result.warnings.length > 0) {
					message += `\n\nWarnings:\n${result.warnings
						.map((w) => `  ⚠️ ${w}`)
						.join('\n')}`;
				}

				return { success: true, message };
			}
			let message = `❌ Recipe execution failed: ${
				result.recipe.name || 'Unknown'
			}`;

			if (result.errors.length > 0) {
				message += `\n\nErrors:\n${result.errors
					.map((e) => `  • ${e}`)
					.join('\n')}`;
			}

			if (result.metadata.completedSteps > 0) {
				message += `\n\nCompleted ${result.metadata.completedSteps}/${result.metadata.totalSteps} steps before failure`;
			}

			return { success: false, message };
		} catch (error: any) {
			if (error instanceof HypergenError) {
				return {
					success: false,
					message: ErrorHandler.formatError(error),
				};
			}

			return {
				success: false,
				message: `❌ Recipe execution failed: ${
					error.message || String(error)
				}`,
			};
		}
	}

	private resolveRecipePath(recipeNameOrPath: string): string | undefined {
		const projectRoot = this.config.cwd || process.cwd();
		const possiblePaths = [
			recipeNameOrPath, // Direct path
			path.join(projectRoot, recipeNameOrPath),
			path.join(projectRoot, '_recipes', recipeNameOrPath),
			path.join(projectRoot, '_recipes', `${recipeNameOrPath}.yml`),
			path.join(projectRoot, '_recipes', `${recipeNameOrPath}.yaml`),
			path.join(projectRoot, 'recipes', recipeNameOrPath),
			path.join(projectRoot, 'recipes', `${recipeNameOrPath}.yml`),
			path.join(projectRoot, 'recipes', `${recipeNameOrPath}.yaml`),
		];

		for (const p of possiblePaths) {
			if (fs.existsSync(p) && (p.endsWith('.yml') || p.endsWith('.yaml'))) {
				return p;
			}
		}
		return undefined;
	}

	private findDefaultRecipe(): string | undefined {
		const projectRoot = this.config.cwd || process.cwd();
		// Convention: look for 'default.yml' or 'default.yaml' in _recipes/ or recipes/
		const possibleDefaultPaths = [
			path.join(projectRoot, '_recipes', 'default.yml'),
			path.join(projectRoot, '_recipes', 'default.yaml'),
			path.join(projectRoot, 'recipes', 'default.yml'),
			path.join(projectRoot, 'recipes', 'default.yaml'),
		];

		for (const p of possibleDefaultPaths) {
			if (fs.existsSync(p)) {
				return p;
			}
		}
		return undefined;
	}

	private async getAvailableRecipeNames(): Promise<string[]> {
		const projectRoot = this.config.cwd || process.cwd();
		const recipeDirs = [
			path.join(projectRoot, '_recipes'),
			path.join(projectRoot, 'recipes'),
		];
		const recipeNames: string[] = [];

		for (const dir of recipeDirs) {
			if (fs.existsSync(dir)) {
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					if (
						entry.isFile() &&
						(entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))
					) {
						recipeNames.push(entry.name.replace(/\.(yml|yaml)$/, ''));
					}
				}
			}
		}
		return [...new Set(recipeNames)]; // Return unique names
	}
}
