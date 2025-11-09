/**
 * Hypergen CLI Interface
 *
 * Main CLI commands for Hypergen
 */

import {
	HypergenConfigLoader,
	type ResolvedConfig,
	createConfigFile,
	getConfigInfo,
} from '../config/hypergen-config.js';
import Logger from '../logger.js';
import {
	RecipeEngine,
	type RecipeEngineConfig,
} from '../recipe-engine/recipe-engine.js';
import type { RunnerConfig } from '../types.js';

// Import core components for command constructors
import { ActionExecutor } from '../actions/index.js';
import { ConsoleActionLogger, DefaultActionUtils } from '../actions/index.js';
import { TemplateURLManager } from '../config/url-resolution/index.js';
import { GeneratorDiscovery } from '../discovery/index.js';
import { GeneratorScaffolding } from './scaffolding.js';

import { ConfigCommand } from './commands/config.js';
import { CookbookCommand } from './commands/cookbook.js';
import { DiscoverCommand } from './commands/discover.js';
import { HelpCommand } from './commands/help.js';
import { InfoCommand } from './commands/info.js';
// Import command classes
import { InitCommand } from './commands/init.js';
import { ListCommand } from './commands/list.js';
import { TemplateCommand } from './commands/template.js';
import { VersionCommand } from './commands/version.js';

export interface HypergenCliConfig extends RunnerConfig {
	discoveryOptions?: {
		sources?: string[];
		directories?: string[];
	};
}

export class HypergenCLI {
	private hypergenConfig?: ResolvedConfig;
	private recipeEngine?: RecipeEngine;
	private consoleLogger = new Logger(console.log);

	// Core components that will be passed to command instances
	private executor = new ActionExecutor();
	private discovery = new GeneratorDiscovery();
	private urlManager = new TemplateURLManager();
	private utils = new DefaultActionUtils();
	private actionLogger = new ConsoleActionLogger();
	private scaffolding = new GeneratorScaffolding();

	// Command instances
	private initCommand: InitCommand;
	private discoverCommand: DiscoverCommand;
	private listCommand: ListCommand;
	private infoCommand: InfoCommand;
	private configCommand: ConfigCommand;
	private templateCommand: TemplateCommand;
	private helpCommand: HelpCommand;
	private versionCommand: VersionCommand;
	private cookbookCommand: CookbookCommand;

	constructor(private config: HypergenCliConfig) {
		// Initialize command classes
		this.initCommand = new InitCommand(this.scaffolding, this.config);
		this.discoverCommand = new DiscoverCommand(this.discovery);
		this.listCommand = new ListCommand(this.executor, this.discovery);
		this.infoCommand = new InfoCommand(this.executor, this.discovery);
		this.configCommand = new ConfigCommand(this.config, this.hypergenConfig); // hypergenConfig will be set in initialize()
		this.templateCommand = new TemplateCommand();
		this.helpCommand = new HelpCommand(
			this.discovery,
			this.urlManager,
			this.config,
		);
		this.versionCommand = new VersionCommand(this.config);
		this.cookbookCommand = new CookbookCommand(
			this.recipeEngine,
			this.consoleLogger,
			this.config,
		); // recipeEngine will be set in initialize()
	}

	/**
	 * Initialize configuration
	 */
	async initialize(): Promise<void> {
		try {
			this.hypergenConfig = await HypergenConfigLoader.loadConfig(
				undefined,
				this.config.cwd || process.cwd(),
			);
			// Update configCommand with resolved config
			this.configCommand = new ConfigCommand(this.config, this.hypergenConfig);
		} catch (error) {
			console.warn('Warning: Could not load configuration file');
		}

		const recipeConfig: RecipeEngineConfig = {
			workingDir: this.config.cwd || process.cwd(),
			enableDebugLogging: process.env.DEBUG?.includes('hypergen') || false,
		};
		this.recipeEngine = new RecipeEngine(recipeConfig);
		// Update cookbookCommand with initialized recipe engine
		this.cookbookCommand = new CookbookCommand(
			this.recipeEngine,
			this.consoleLogger,
			this.config,
		);
	}

	/**
	 * Parse and execute commands
	 */
	async execute(
		argv: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [command, ...args] = argv;

		switch (command) {
			case 'init':
				return this.initCommand.execute(args);

			case 'discover':
				return this.discoverCommand.execute(args);

			case 'list':
				return this.listCommand.execute(args);

			case 'info':
				return this.infoCommand.execute(args);

			case 'config':
				return this.configCommand.execute(args);

			case 'template':
				return this.templateCommand.execute(args);

			case 'help':
				return this.helpCommand.execute();

			case 'version':
				return this.versionCommand.execute();

			case 'cookbook':
				return this.cookbookCommand.execute(args);

			default:
				return {
					success: false,
					message: `Unknown command: ${command}. Use 'hypergen help' for available commands.`,
				};
		}
	}
}
