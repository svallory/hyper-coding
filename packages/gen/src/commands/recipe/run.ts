/**
 * Recipe Run command - Execute a recipe file
 * This is the main command for running recipes from within the recipe topic
 */

import fs from "node:fs";
import { Args } from "@oclif/core";
import { AiCollector } from "#/ai/ai-collector";
import type { AiServiceConfig } from "#/ai/ai-config";
import { resolveTransport } from "#/ai/transports/index";
import { BaseCommand } from "#/lib/base-command";
import { executionFlags, outputFlags } from "#/lib/flags";
import type { RecipeExecutionOptions, RecipeExecutionResult } from "#/recipe-engine/recipe-engine";

export default class RecipeRun extends BaseCommand<typeof RecipeRun> {
	static override description = "Execute a recipe to generate code";

	static override examples = [
		"<%= config.bin %> recipe run my-recipe.yml",
		"<%= config.bin %> recipe run .hyper/kits/my-kit/cookbooks/component/recipe.yml --name=Button",
		"<%= config.bin %> recipe run recipe.yml --dry",
		"<%= config.bin %> recipe run recipe.yml --answers ./ai-answers.json",
		"<%= config.bin %> recipe run recipe.yml --ai-mode stdout",
	];

	static override flags = {
		...executionFlags,
		...outputFlags,
	};

	static override args = {
		recipe: Args.string({
			description: "Path to recipe file (.yml or .yaml)",
			required: true,
		}),
	};

	// Allow pass-through for recipe variables
	static override strict = false;

	private reportResult(result: RecipeExecutionResult, flags: Record<string, any>): void {
		if (flags.json) {
			this.log(
				JSON.stringify(
					{
						success: result.success,
						recipe: result.recipe.name,
						stepsCompleted: result.metadata.completedSteps,
						filesCreated: result.filesCreated,
						filesModified: result.filesModified,
						errors: result.errors,
					},
					null,
					2,
				),
			);
			return;
		}

		if (result.success) {
			const prefix = flags.dryRun ? "[DRY RUN] " : "";
			this.log(`${prefix}Recipe '${result.recipe.name}' completed successfully`);

			if (result.metadata.completedSteps > 0) {
				this.log(`Steps executed: ${result.metadata.completedSteps}`);
			}

			if (result.filesCreated.length > 0) {
				const verb = flags.dryRun ? "would be created" : "created";
				this.log(`Files ${verb}: ${result.filesCreated.join(", ")}`);
			}

			if (result.filesModified.length > 0) {
				const verb = flags.dryRun ? "would be modified" : "modified";
				this.log(`Files ${verb}: ${result.filesModified.join(", ")}`);
			}
		} else {
			this.log("Recipe execution failed:");
			for (const error of result.errors) {
				this.log(`  - ${error}`);
			}
			this.exit(1);
		}
	}

	async run(): Promise<void> {
		const { args, argv, flags } = await this.parse(RecipeRun);
		const recipePath = args.recipe;

		// Parse additional parameters
		const remainingArgs = (argv as string[]).slice(1);
		const variables = this.parseParameters(remainingArgs);

		// Load AI answers if provided (Pass 2)
		let answers: Record<string, any> | undefined;
		if (flags.answers) {
			try {
				const content = fs.readFileSync(flags.answers, "utf-8");
				answers = JSON.parse(content);
			} catch (error) {
				this.error(
					`Failed to load answers file: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Initialize AiCollector for Pass 1 if no answers provided
		const collector = AiCollector.getInstance();
		collector.clear();
		if (!answers) {
			collector.collectMode = true;
		}

		const options: RecipeExecutionOptions = {
			variables,
			workingDir: flags.cwd,
			dryRun: flags.dryRun,
			force: flags.force,
			skipPrompts: flags.skipPrompts || flags.defaults,
			continueOnError: flags.continueOnError,
			logger: this.consoleLogger,
			answers,
		};

		try {
			let result = await this.recipeEngine.executeRecipe(recipePath, options);

			// Check if Pass 1 collected any AI entries
			if (collector.collectMode && collector.hasEntries()) {
				// CLI flag overrides config
				const aiConfig: AiServiceConfig = { ...this.hypergenConfig?.ai };
				const aiModeFlag = flags["ai-mode"] as AiServiceConfig["mode"] | undefined;
				if (aiModeFlag) aiConfig.mode = aiModeFlag;

				const originalCommand = [
					"hypergen",
					"recipe",
					"run",
					recipePath,
					...process.argv.slice(4).filter((a) => a !== "--answers" && !a.endsWith(".json")),
				].join(" ");

				const transport = resolveTransport(aiConfig);
				const transportResult = await transport.resolve({
					collector,
					config: aiConfig,
					originalCommand,
					answersPath: "./ai-answers.json",
					projectRoot: flags.cwd,
					promptTemplate: aiConfig.promptTemplate,
				});

				collector.clear();

				if (transportResult.status === "deferred") {
					this.exit(transportResult.exitCode);
					return;
				}

				// Answers resolved inline — auto-run Pass 2
				collector.collectMode = false;
				result = await this.recipeEngine.executeRecipe(recipePath, {
					...options,
					answers: transportResult.answers,
				});
			}

			collector.clear();
			this.reportResult(result, flags);
		} catch (error: unknown) {
			collector.clear();
			const message = error instanceof Error ? error.message : String(error);
			this.error(`Failed to execute recipe: ${message}`);
		}
	}
}
