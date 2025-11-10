import { Command, Flags, Args } from '@oclif/core';
import Logger from '../logger.js';
import {
	RecipeEngine,
	type RecipeExecutionOptions,
} from '../recipe-engine/recipe-engine.js';
import type { RunnerConfig } from '../types.js';

export default class Cookbook extends Command {
	static description = 'Run a recipe from a cookbook';

	static examples = [
		'<%= config.bin %> starlight create',
		'<%= config.bin %> starlight add page --title="My Page"',
		'<%= config.bin %> cookbook default',
		'<%= config.bin %> cookbook recipe --name=MyComponent',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
		'dry-run': Flags.boolean({
			description: 'Run without making changes',
			default: false,
		}),
		force: Flags.boolean({
			char: 'f',
			description: 'Force overwrite existing files',
			default: false,
		}),
		'skip-prompts': Flags.boolean({
			description: 'Skip interactive prompts and use defaults',
			default: false,
		}),
		'use-defaults': Flags.boolean({
			description: 'Alias for --skip-prompts',
			default: false,
		}),
		'continue-on-error': Flags.boolean({
			description: 'Continue execution even if a step fails',
			default: false,
		}),
		debug: Flags.boolean({
			description: 'Enable debug mode',
			default: false,
		}),
	};

	static args = {
		cookbook: Args.string({
			name: 'cookbook',
			required: false,
			description: 'Cookbook name (defaults to built-in "cookbook")',
			default: 'cookbook',
		}),
		recipe: Args.string({
			name: 'recipe',
			required: false,
			description: 'Recipe name (defaults to "default")',
		}),
	};

	static strict = false; // Allow additional args for recipe variables

	async run(): Promise<void> {
		const { args, flags, argv } = await this.parse(Cookbook);

		const config: RunnerConfig = {
			cwd: process.cwd(),
			debug: flags.debug,
		};

		const recipeEngineConfig = {
			workingDir: config.cwd || process.cwd(),
			enableDebugLogging: flags.debug,
		};

		const recipeEngine = new RecipeEngine(recipeEngineConfig);
		const logger = new Logger(console.log);

		// Parse additional variables from remaining args
		const variables: Record<string, any> = {};
		const remainingArgs = argv.slice(args.recipe ? 2 : 1);

		for (const arg of remainingArgs) {
			if (arg.startsWith('--')) {
				const [key, ...valueParts] = arg.slice(2).split('=');
				const value = valueParts.join('=') || 'true';
				variables[key] = value;
			}
		}

		const options: RecipeExecutionOptions = {
			variables,
			workingDir: config.cwd || process.cwd(),
			dryRun: flags['dry-run'],
			force: flags.force,
			continueOnError: flags['continue-on-error'],
			skipPrompts: flags['skip-prompts'] || flags['use-defaults'],
			logger,
			onProgress: (progress) => {
				this.log(
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
				this.log(`${status} Step: ${result.stepName} (${result.duration}ms)`);
			},
		};

		try {
			// Build recipe path: cookbook/recipe or cookbook/default
			const recipePath = args.recipe
				? `${args.cookbook}/${args.recipe}`
				: args.cookbook;

			this.log(`🚀 Running recipe: ${recipePath}`);

			const result = await recipeEngine.executeRecipe(recipePath, options);

			if (result.success) {
				this.log(`\n✅ Recipe completed successfully`);
				if (result.filesCreated?.length) {
					this.log(`\nFiles created: ${result.filesCreated.length}`);
					for (const file of result.filesCreated) {
						this.log(`  • ${file}`);
					}
				}
			} else {
				this.error(
					`❌ Recipe failed: ${result.error || 'Unknown error'}`,
					{ exit: 1 },
				);
			}
		} catch (error: any) {
			this.error(`Failed to execute recipe: ${error.message}`, { exit: 1 });
		}
	}
}
