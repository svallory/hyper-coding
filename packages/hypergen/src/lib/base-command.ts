/**
 * Base command class for all Hypergen oclif commands
 */

import { Command, Flags, Interfaces } from "@oclif/core";
import { ActionExecutor } from "#/actions/index";
import { GeneratorDiscovery } from "#/discovery/index";
import { TemplateURLManager } from "#/config/url-resolution/index";
import { DefaultActionUtils, ConsoleActionLogger } from "#/actions/index";
import { TemplateParser } from "#/config/template-parser";
import { GeneratorScaffolding } from "#/cli/scaffolding";
import { HypergenConfigLoader, type ResolvedConfig } from "#/config/hypergen-config";
import { RecipeEngine, type RecipeEngineConfig } from "#/recipe-engine/recipe-engine";
import { registerDefaultTools, getToolRegistry } from "#/recipe-engine/tools/index";
import Logger from "#/logger";

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
	(typeof BaseCommand)["baseFlags"] & T["flags"]
>;
export type BaseArgs<T extends typeof Command> = Interfaces.InferredArgs<T["args"]>;

/**
 * Abstract base command that all Hypergen commands extend
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
		config: Flags.file({
			description: "Path to config file",
			env: "HYPERGEN_CONFIG",
		}),
	};

	protected flags!: BaseFlags<T>;
	protected args!: BaseArgs<T>;

	// Services - initialized in init()
	protected hypergenConfig?: ResolvedConfig;
	protected executor!: ActionExecutor;
	protected discovery!: GeneratorDiscovery;
	protected urlManager!: TemplateURLManager;
	protected templateParser!: TemplateParser;
	protected scaffolding!: GeneratorScaffolding;
	protected recipeEngine!: RecipeEngine;
	protected actionUtils!: DefaultActionUtils;
	protected actionLogger!: ConsoleActionLogger;
	protected consoleLogger!: Logger;

	async init(): Promise<void> {
		await super.init();

		const { args, flags } = await this.parse({
			flags: this.ctor.flags,
			baseFlags: (super.ctor as typeof BaseCommand).baseFlags,
			args: this.ctor.args,
			strict: this.ctor.strict,
		});

		this.flags = flags as BaseFlags<T>;
		this.args = args as BaseArgs<T>;

		// Enable debug if flag is set
		if (this.flags.debug) {
			process.env.DEBUG = process.env.DEBUG ? `${process.env.DEBUG},hypergen:*` : "hypergen:*";
		}

		// Load configuration
		try {
			this.hypergenConfig = await HypergenConfigLoader.loadConfig(
				this.flags.config,
				this.flags.cwd,
			);
		} catch {
			// Configuration is optional
		}

		// Initialize services
		this.executor = new ActionExecutor();
		this.discovery = new GeneratorDiscovery({
			directories: this.hypergenConfig?.discovery?.directories,
			enabledSources: this.hypergenConfig?.discovery?.sources as any,
			startDir: this.flags.cwd,
		});
		this.urlManager = new TemplateURLManager();
		this.templateParser = new TemplateParser();
		this.scaffolding = new GeneratorScaffolding();
		this.actionUtils = new DefaultActionUtils();
		this.actionLogger = new ConsoleActionLogger();
		this.consoleLogger = new Logger(console.log);

		// Initialize recipe engine
		const recipeConfig: RecipeEngineConfig = {
			workingDir: this.flags.cwd,
			enableDebugLogging: this.flags.debug,
		};
		this.recipeEngine = new RecipeEngine(recipeConfig);

		// Register default tools
		registerDefaultTools();
	}

	/**
	 * Parse additional parameters from remaining argv
	 * Supports both --key=value and --key value formats
	 */
	protected parseParameters(argv: string[]): Record<string, unknown> {
		const params: Record<string, unknown> = {};

		for (let i = 0; i < argv.length; i++) {
			const arg = argv[i];

			if (arg === "--") continue; // skip separator

			if (arg.startsWith("--")) {
				const withoutPrefix = arg.slice(2);

				if (withoutPrefix.includes("=")) {
					// --key=value format
					const [key, ...valueParts] = withoutPrefix.split("=");
					const value = valueParts.join("=");
					params[key] = this.parseValue(value);
				} else {
					// --key value or --flag format
					const nextArg = argv[i + 1];
					if (nextArg && !nextArg.startsWith("--")) {
						params[withoutPrefix] = this.parseValue(nextArg);
						i++; // Skip next arg
					} else {
						params[withoutPrefix] = true;
					}
				}
			}
		}

		return params;
	}

	/**
	 * Parse a string value to appropriate type
	 */
	private parseValue(value: string): unknown {
		// Boolean
		if (value === "true") return true;
		if (value === "false") return false;

		// Number
		const num = Number(value);
		if (!isNaN(num) && value.trim() !== "") return num;

		// String
		return value;
	}

	async catch(error: Error & { exitCode?: number }): Promise<void> {
		// Custom error formatting could go here
		throw error;
	}

	async finally(_: Error | undefined): Promise<void> {
		// Cleanup if needed
		try {
			// Clean up the recipe engine if it exists
			if (this.recipeEngine) {
				this.recipeEngine.cleanup();
			}

			// Clean up the tool registry to prevent hanging timers
			const registry = getToolRegistry();
			registry.cleanup();
		} catch {
			// Ignore cleanup errors
		}
	}
}
