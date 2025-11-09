// src/cli/commands/config.ts

import {
	HypergenConfigLoader,
	type ResolvedConfig,
	createConfigFile,
	getConfigInfo,
} from '../../config/hypergen-config.js';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import type { RunnerConfig } from '../../types.js';
import { parseParameters } from '../utils/command-parser.js';

export class ConfigCommand {
	private hypergenConfig?: ResolvedConfig;
	private config: RunnerConfig;

	constructor(config: RunnerConfig, hypergenConfig?: ResolvedConfig) {
		this.config = config;
		this.hypergenConfig = hypergenConfig;
	}

	/**
	 * Handle configuration commands
	 * Usage: hypergen config <subcommand> [args...]
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [subcommand, ...subArgs] = args;

		switch (subcommand) {
			case 'init':
				return this.initConfig(subArgs);

			case 'show':
				return this.showConfig();

			case 'validate':
				return this.validateConfig(subArgs);

			case 'info':
				return this.showConfigInfo();

			default:
				return {
					success: false,
					message:
						'Config subcommand required. Available: init, show, validate, info',
				};
		}
	}

	/**
	 * Initialize configuration file
	 */
	private async initConfig(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const parameters = parseParameters(args);
		const format = parameters.format === 'json' ? 'json' : 'js';
		const projectRoot = this.config.cwd || process.cwd();

		try {
			const configPath = await createConfigFile(projectRoot, format);

			return {
				success: true,
				message: `✅ Configuration file created: ${configPath}\n\nNext steps:\n  1. Edit the configuration file to match your needs\n  2. Validate: hypergen config validate\n  3. View info: hypergen config info`,
			};
		} catch (error: any) {
			if (error instanceof HypergenError) {
				return {
					success: false,
					message: ErrorHandler.formatError(error),
				};
			}

			return {
				success: false,
				message: `❌ Failed to create configuration file: ${error.message}`,
			};
		}
	}

	/**
	 * Show current configuration
	 */
	private async showConfig(): Promise<{ success: boolean; message?: string }> {
		try {
			if (!this.hypergenConfig) {
				// This should ideally be handled by the main CLI, but for now, re-initialize if needed
				// In a proper oclif setup, hypergenConfig would be passed in or initialized globally
				throw new Error('HypergenConfig not initialized.');
			}

			const config = this.hypergenConfig;
			let message = `📝 Configuration (${config.configPath}):\n\n`;

			message += `Templates: ${config.templates.join(', ')}\n`;
			message += `Environment: ${config.environment}\n`;
			message += `Engine: ${config.engine.type}\n`;
			message += `Conflict Strategy: ${config.output.conflictStrategy}\n`;
			message += `Cache Enabled: ${config.cache.enabled}\n`;
			message += `Validation: ${
				config.validation.strict ? 'strict' : 'relaxed'
			}\n`;

			if (config.discovery.sources.length > 0) {
				message += `Discovery Sources: ${config.discovery.sources.join(
					', ',
				)}\n`;
			}

			if (config.plugins.length > 0) {
				message += `Plugins: ${config.plugins.join(', ')}\n`;
			}

			if (Object.keys(config.loadedHelpers).length > 0) {
				message += `Helpers: ${Object.keys(config.loadedHelpers).join(', ')}\n`;
			}

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Failed to show configuration: ${error.message}`,
			};
		}
	}

	/**
	 * Validate configuration
	 */
	private async validateConfig(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [configPath] = args;
		const projectRoot = this.config.cwd || process.cwd();

		try {
			const config = await HypergenConfigLoader.loadConfig(
				configPath,
				projectRoot,
			);
			const validation = HypergenConfigLoader.validateConfig(config);

			if (validation.valid) {
				return {
					success: true,
					message: `✅ Configuration is valid

Configuration loaded from: ${config.configPath}
Environment: ${config.environment}
Templates: ${config.templates.length} directories
Plugins: ${config.plugins.length} loaded`,
				};
			}
			return {
				success: false,
				message: `❌ Configuration validation failed:

${validation.errors.map((error) => `  • ${error}`).join('\n')}`,
			};
		} catch (error: any) {
			if (error instanceof HypergenError) {
				return {
					success: false,
					message: ErrorHandler.formatError(error),
				};
			}

			return {
				success: false,
				message: `❌ Failed to validate configuration: ${error.message}`,
			};
		}
	}

	/**
	 * Show configuration information
	 */
	private async showConfigInfo(): Promise<{
		success: boolean;
		message?: string;
	}> {
		try {
			if (!this.hypergenConfig) {
				// This should ideally be handled by the main CLI, but for now, re-initialize if needed
				throw new Error('HypergenConfig not initialized.');
			}

			const info = getConfigInfo(this.hypergenConfig);

			let message = '📋 Configuration Information\n\n';
			message += `Source: ${info.source}\n`;
			message += `Environment: ${info.environment}\n`;
			message += `Templates: ${info.templates.length} directories\n`;

			if (info.templates.length > 0) {
				message += `  ${info.templates.map((t) => `• ${t}`).join('\n  ')}\n`;
			}

			message += `Cache: ${info.cacheEnabled ? 'enabled' : 'disabled'}\n`;
			message += `Plugins: ${info.pluginCount} loaded\n`;
			message += `Helpers: ${info.helperCount} loaded\n`;

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Failed to get configuration info: ${error.message}`,
			};
		}
	}
}
