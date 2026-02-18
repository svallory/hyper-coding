/**
 * Main command for executing recipes
 * Usage: hyper gen <recipe> [options]
 * Or shorthand: hyper <kit> <recipe-path>
 */

import fs from "node:fs";
import path from "node:path";
import { PathResolver, type ResolvedPath } from "@hypercli/core";
import { discoverKits, getDefaultKitSearchDirs } from "@hypercli/core";
import type { TemplateVariable } from "@hypercli/core";

import { Args, Flags } from "@oclif/core";
import { AiCollector } from "#ai/ai-collector";
import { resolveTransport } from "#ai/transports/resolve-transport";
import { BaseCommand } from "#lib/base-command";
import { GroupExecutor } from "#recipe-engine/group-executor";

export default class Gen extends BaseCommand<typeof Gen> {
	static override description = "Execute a recipe to generate code";

	static override examples = [
		"<%= config.bin %> gen ./my-recipe",
		"<%= config.bin %> gen @kit/starlight/create",
		"<%= config.bin %> gen create-component --name=Button",
		"<%= config.bin %> gen ./my-recipe --answers ./ai-answers.json",
		"<%= config.bin %> gen crud edit-page --model=Organization",
		"<%= config.bin %> nextjs crud update Organization",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		dry: Flags.boolean({
			description: "Show what would be generated without writing files",
			default: false,
		}),
		force: Flags.boolean({
			char: "f",
			description: "Overwrite existing files",
			default: false,
		}),
		yes: Flags.boolean({
			char: "y",
			description: "Skip confirmation prompts",
			default: false,
		}),
		answers: Flags.file({
			description: "Path to AI answers JSON file (2-pass generation)",
		}),
		"prompt-template": Flags.file({
			description: "Path to a custom Jig template for the AI prompt document",
		}),
		ask: Flags.string({
			description:
				"Who resolves missing variables: me (interactive), ai (use configured transport), stdout (print prompt doc to stdout), nobody (error)",
			options: ["me", "ai", "stdout", "nobody"],
		}),
		"no-defaults": Flags.boolean({
			description: "Don't use default values — ask about every variable",
			default: false,
		}),
	};

	static override args = {
		recipe: Args.string({
			description: "Recipe to execute (path, package, or cookbook/recipe)",
			required: true,
		}),
	};

	static override strict = false;

	/**
	 * Names of all flags that are explicitly declared on this command (and its base).
	 * Used to strip unknown --key=value recipe variables from argv before oclif
	 * parses it — oclif v4 throws NonExistentFlagsError on unknown flags even when
	 * `strict = false` (strict only affects extra positional args, not flags).
	 */
	private static get knownFlagNames(): Set<string> {
		const names = new Set<string>();
		const allFlags = { ...BaseCommand.baseFlags, ...Gen.flags };
		for (const [name, def] of Object.entries(allFlags)) {
			names.add(name);
			// Also register any aliases declared on the flag
			const flagDef = def as { aliases?: string[]; char?: string };
			if (flagDef.aliases) {
				for (const alias of flagDef.aliases) names.add(alias);
			}
		}
		return names;
	}

	/**
	 * Split argv into two arrays:
	 * - safeArgv: only known flags + positional args (safe to pass to oclif)
	 * - fullArgv: the original argv (used by parseParameters / extractPathSegments)
	 */
	private splitArgv(argv: string[]): { safeArgv: string[]; fullArgv: string[] } {
		const known = Gen.knownFlagNames;
		const safeArgv: string[] = [];
		let i = 0;
		while (i < argv.length) {
			const arg = argv[i];
			if (arg === "--") {
				// Everything after `--` is safe to pass through as-is
				safeArgv.push(...argv.slice(i));
				break;
			}
			if (arg.startsWith("--")) {
				const eqIdx = arg.indexOf("=");
				const flagName = eqIdx > 0 ? arg.slice(2, eqIdx) : arg.slice(2);
				if (known.has(flagName)) {
					safeArgv.push(arg);
					// If it's --flag value (no `=`), also carry forward the value token
					if (eqIdx < 0 && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
						i++;
						safeArgv.push(argv[i]);
					}
				}
				// Unknown --key or --key=value: drop from safeArgv (oclif won't see it)
			} else if (arg.startsWith("-") && arg.length === 2) {
				// Short flag: keep only if it belongs to a known flag
				const shortChar = arg.slice(1);
				const isKnown = Object.values({ ...BaseCommand.baseFlags, ...Gen.flags }).some(
					(f) => (f as { char?: string }).char === shortChar,
				);
				if (isKnown) {
					safeArgv.push(arg);
					// Carry the value token for -f value style
					if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
						i++;
						safeArgv.push(argv[i]);
					}
				}
			} else {
				// Positional arg — always safe
				safeArgv.push(arg);
			}
			i++;
		}
		return { safeArgv, fullArgv: argv };
	}

	async run(): Promise<void> {
		// oclif v4 throws NonExistentFlagsError for unknown flags even with strict=false.
		// Recipe variables like --name=Button are unknown to oclif but valid for us.
		// Strip them from argv before parse(), then use the original argv for parseParameters().
		const fullArgv = this.argv as string[];
		const { safeArgv } = this.splitArgv(fullArgv);
		this.argv = safeArgv;

		const { flags } = await this.parse(Gen);
		const argv = fullArgv; // use original argv for path/param extraction
		await this.resolveEffectiveCwd(flags);

		// Collect all non-flag segments for path resolution
		const segments = this.extractPathSegments(argv as string[]);

		// Resolve recipe path using PathResolver
		const resolved = await this.resolveRecipePath(segments, flags.cwd);

		if (!resolved) {
			this.error(`Recipe not found: ${segments.join(" ")}\nTry 'hyper gen --help' for usage.`);
		}

		// Parse named parameters (--key=value and --key value)
		const namedParams = this.parseParameters(argv as string[]);

		// Map positional args to variables if recipe has position definitions
		const positionalParams = await this.mapPositionalArgs(resolved);
		const params = { ...positionalParams, ...namedParams }; // named wins

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

		// Determine effective ask mode
		// --ask=stdout is sugar for --ask=ai with the stdout transport forced
		const askFlag = flags.ask as "me" | "ai" | "stdout" | "nobody" | undefined;
		const askMode: "me" | "ai" | "nobody" =
			askFlag === "stdout" ? "ai" : (askFlag ?? (process.stdout.isTTY ? "me" : "nobody"));
		const aiConfigOverride = askFlag === "stdout" ? { mode: "stdout" as const } : undefined;

		const noDefaults = flags["no-defaults"] ?? false;

		if (resolved.type === "group") {
			return this.executeGroup(
				resolved,
				params,
				flags,
				answers,
				askMode,
				noDefaults,
				aiConfigOverride,
			);
		}

		return this.executeSingleRecipe(
			resolved,
			params,
			flags,
			answers,
			askMode,
			noDefaults,
			aiConfigOverride,
		);
	}

	/**
	 * Execute a single recipe
	 */
	private async executeSingleRecipe(
		resolved: ResolvedPath,
		params: Record<string, unknown>,
		flags: Record<string, any>,
		answers?: Record<string, any>,
		askMode: "me" | "ai" | "nobody" = "me",
		noDefaults = false,
		aiConfigOverride?: Partial<import("#ai/ai-config").AiServiceConfig>,
	): Promise<void> {
		// Initialize AiCollector for Pass 1 if no answers provided
		const collector = AiCollector.getInstance();
		collector.clear();
		if (!answers) {
			collector.collectMode = true;
		}

		if (answers) {
			this.log(`Executing recipe: ${resolved.fullPath}`);
		}

		if (flags.dry) {
			this.log("(dry run - no files will be written)");
		}

		const aiConfig = aiConfigOverride
			? { ...this.hypergenConfig?.ai, ...aiConfigOverride }
			: this.hypergenConfig?.ai;

		try {
			let result = await this.recipeEngine.executeRecipe(
				{ type: "file", path: resolved.fullPath },
				{
					variables: params,
					workingDir: flags.cwd,
					dryRun: flags.dry,
					force: flags.force,
					answers,
					askMode,
					noDefaults,
					aiConfig,
				},
			);

			// Check if Pass 1 collected any AI entries
			if (collector.collectMode && collector.hasEntries()) {
				const transport = resolveTransport(aiConfig);
				const originalCommand = [
					"hyper",
					"gen",
					...resolved.consumed,
					...process.argv.slice(3).filter((a) => a !== "--answers" && !a.endsWith(".json")),
				].join(" ");
				const promptTemplatePath = flags["prompt-template"] || aiConfig?.promptTemplate;

				const transportResult = await transport.resolve({
					collector,
					config: aiConfig ?? {},
					originalCommand,
					answersPath: "./ai-answers.json",
					projectRoot: flags.cwd,
					promptTemplate: promptTemplatePath,
				});

				if (transportResult.status === "deferred") {
					collector.clear();
					this.exit(transportResult.exitCode);
					return;
				}

				// Transport resolved answers inline — re-run as Pass 2
				collector.clear();
				collector.collectMode = false;
				result = await this.recipeEngine.executeRecipe(
					{ type: "file", path: resolved.fullPath },
					{
						variables: params,
						workingDir: flags.cwd,
						dryRun: flags.dry,
						force: flags.force,
						answers: transportResult.answers,
						askMode: "nobody",
						noDefaults,
						aiConfig,
					},
				);
			}

			// Pass 1 found no @ai entries — recipe doesn't use AI generation.
			// Re-run without collect mode so files are actually written.
			if (collector.collectMode) {
				collector.collectMode = false;
				collector.clear();
				result = await this.recipeEngine.executeRecipe(
					{ type: "file", path: resolved.fullPath },
					{
						variables: params,
						workingDir: flags.cwd,
						dryRun: flags.dry,
						force: flags.force,
						answers,
						askMode: "nobody", // Don't prompt again — variables already resolved
						noDefaults,
						aiConfig,
					},
				);
			} else {
				collector.clear();
			}

			if (result.success) {
				this.log("\n✓ Recipe completed successfully");
				this.log(`  Steps completed: ${result.metadata.completedSteps}`);
				if (result.filesCreated.length > 0) {
					this.log(`  Files created: ${result.filesCreated.length}`);
				}
				if (result.filesModified.length > 0) {
					this.log(`  Files modified: ${result.filesModified.length}`);
				}
			} else {
				const errorMsg = result.errors.length > 0 ? result.errors.join(", ") : "Unknown error";
				this.error(`Recipe failed: ${errorMsg}`);
			}
		} catch (error: any) {
			collector.clear();
			if (error?.code === "EEXIT") throw error;
			this.error(
				`Failed to execute recipe: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Execute a group of recipes with dependency resolution
	 */
	private async executeGroup(
		resolved: ResolvedPath,
		params: Record<string, unknown>,
		flags: Record<string, any>,
		answers?: Record<string, any>,
		askMode: "me" | "ai" | "nobody" = "me",
		noDefaults = false,
		aiConfigOverride?: Partial<import("#ai/ai-config").AiServiceConfig>,
	): Promise<void> {
		const groupExecutor = new GroupExecutor(this.recipeEngine);

		this.log(`Executing recipe group: ${resolved.fullPath}`);
		if (flags.dry) {
			this.log("(dry run - no files will be written)");
		}

		try {
			const group = await groupExecutor.discoverGroup(resolved.fullPath);

			if (group.recipes.length === 0) {
				this.error(`No recipes found in directory: ${resolved.fullPath}`);
			}

			this.log(
				`Found ${group.recipes.length} recipes: ${group.recipes.map((r) => r.name).join(", ")}`,
			);

			const groupAiConfig = aiConfigOverride
				? { ...this.hypergenConfig?.ai, ...aiConfigOverride }
				: this.hypergenConfig?.ai;

			const result = await groupExecutor.executeGroup(group, params as Record<string, any>, {
				variables: params,
				workingDir: flags.cwd,
				dryRun: flags.dry,
				force: flags.force,
				answers,
				continueOnError: false,
				askMode,
				noDefaults,
				aiConfig: groupAiConfig,
			});

			if (result.success) {
				this.log("\n✓ Group execution completed successfully");
				this.log(`  Recipes executed: ${result.recipeResults.length}`);
				for (const rr of result.recipeResults) {
					const status = rr.result.success ? "✓" : "✗";
					this.log(`  ${status} ${rr.name}: ${rr.result.metadata.completedSteps} steps`);
				}
			} else {
				const errorMsg = result.errors.length > 0 ? result.errors.join("\n  ") : "Unknown error";
				this.error(`Group execution failed:\n  ${errorMsg}`);
			}
		} catch (error: any) {
			if (error?.code === "EEXIT") throw error;
			this.error(
				`Failed to execute group: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Extract non-flag path segments from argv.
	 * Everything before `--` and not starting with `-` is a path segment.
	 */
	private extractPathSegments(argv: string[]): string[] {
		const segments: string[] = [];

		for (const arg of argv) {
			if (arg === "--") break;
			if (arg.startsWith("-")) {
				// If it's --key=value, skip
				if (arg.startsWith("--")) {
					// If next arg is the value (--key value), we'll handle that in parseParameters
					// but we need to skip it here
					const withoutPrefix = arg.slice(2);
					if (!withoutPrefix.includes("=")) {
						// The next non-flag arg would be the value — but we can't know that here
						// without lookahead. For safety, just skip flags.
					}
				}
				continue;
			}
			segments.push(arg);
		}

		return segments;
	}

	/**
	 * Resolve recipe path using the PathResolver with kit/cookbook discovery
	 */
	private async resolveRecipePath(segments: string[], cwd: string): Promise<ResolvedPath | null> {
		if (segments.length === 0) return null;

		// cwd is already resolved by resolveEffectiveCwd (hyper.config dir or monorepo root)
		const projectRoot = cwd;

		// Discover kits from project root
		const kitSearchDirs = getDefaultKitSearchDirs(projectRoot);

		// Also add configured search directories
		const configDirs = this.hypergenConfig?.discovery?.directories || [];
		const allSearchDirs = [
			...configDirs.map((d: string) => path.resolve(cwd, d)),
			path.resolve(cwd, ".hypergen/cookbooks"),
			path.resolve(cwd, "cookbooks"),
		];

		const kits = await discoverKits(kitSearchDirs);

		const resolver = new PathResolver(kits, allSearchDirs, cwd);
		return resolver.resolve(segments);
	}

	/**
	 * Map positional args (resolved.remaining) to recipe variables by position.
	 */
	private async mapPositionalArgs(resolved: ResolvedPath): Promise<Record<string, any>> {
		if (resolved.remaining.length === 0) return {};
		if (resolved.type !== "recipe") return {};

		try {
			// Load the recipe to get variable definitions
			const loadResult = await this.recipeEngine.loadRecipe({
				type: "file",
				path: resolved.fullPath,
			});

			const variables = loadResult.recipe.variables;
			if (!variables) return {};

			// Find variables with `position` field, sorted by position
			const positionalVars: Array<{
				name: string;
				position: number;
				config: TemplateVariable;
			}> = [];
			for (const [name, config] of Object.entries(variables)) {
				if (config.position !== undefined) {
					positionalVars.push({ name, position: config.position, config });
				}
			}

			positionalVars.sort((a, b) => a.position - b.position);

			// Map remaining segments to positional variables
			const mapped: Record<string, any> = {};
			for (let i = 0; i < Math.min(resolved.remaining.length, positionalVars.length); i++) {
				mapped[positionalVars[i].name] = resolved.remaining[i];
			}

			return mapped;
		} catch {
			// If we can't load the recipe, return empty — error will surface during execution
			return {};
		}
	}

	/**
	 * Parse named parameters from argv (--key=value or --key value)
	 */
	private parseParameters(argv: string[]): Record<string, unknown> {
		const params: Record<string, unknown> = {};
		for (let i = 0; i < argv.length; i++) {
			const arg = argv[i];
			if (arg.startsWith("--")) {
				const eqIndex = arg.indexOf("=");
				if (eqIndex > 0) {
					// --key=value format
					const key = arg.slice(2, eqIndex);
					const value = arg.slice(eqIndex + 1);
					params[key] = value;
				} else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
					// --key value format
					const key = arg.slice(2);
					params[key] = argv[i + 1];
					i++; // skip next
				}
			}
		}
		return params;
	}
}
