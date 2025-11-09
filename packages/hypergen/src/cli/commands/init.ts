// src/cli/commands/init.ts

import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import type { RunnerConfig } from '../../types.js';
import type {
	GeneratorScaffolding,
	ScaffoldingOptions,
} from '../scaffolding.js';
import { parseParameters } from '../utils/command-parser.js';

// Type for workspace init options
interface WorkspaceInitOptions {
	directory?: string;
	withExamples?: boolean;
}

// Type for generator init result
interface InitResult {
	success: boolean;
	message?: string;
	filesCreated?: string[];
}

/**
 * InitCommand - CLI command handler for workspace initialization
 *
 * This class handles ALL user-facing aspects of the init command:
 * - Parameter validation
 * - Message formatting
 * - Error handling and display
 * - Success messages and next steps
 *
 * It delegates the actual file generation to GeneratorScaffolding.
 */
export class InitCommand {
	private scaffolding: GeneratorScaffolding;
	private config: RunnerConfig;

	constructor(scaffolding: GeneratorScaffolding, config: RunnerConfig) {
		this.scaffolding = scaffolding;
		this.config = config;
	}

	/**
	 * Handle init commands
	 * Usage: hypergen init <type> [options...]
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [type, ...initArgs] = args;

		switch (type) {
			case 'generator':
				return this.initGenerator(initArgs);

			case 'workspace':
				return this.initWorkspace(initArgs);

			default:
				return {
					success: false,
					message: 'Init type required. Available: generator, workspace',
				};
		}
	}

	/**
	 * Initialize a new generator
	 */
	private async initGenerator(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const parameters = parseParameters(args);

		// Validate name parameter
		const nameValidation = this.validateGeneratorName(parameters.name);
		if (!nameValidation.valid) {
			return { success: false, message: nameValidation.error };
		}

		try {
			const options = this.buildGeneratorOptions(parameters);

			// Validate options
			const optionsValidation = this.validateGeneratorOptions(options);
			if (!optionsValidation.valid) {
				return { success: false, message: optionsValidation.error };
			}

			// Execute scaffolding recipe
			const result = await this.scaffolding.initGenerator(options);

			// Format and return result
			return this.formatGeneratorResult(result, options);
		} catch (error: any) {
			return this.handleError(error, 'init-generator');
		}
	}

	/**
	 * Validate generator name parameter
	 */
	private validateGeneratorName(name: string | undefined): {
		valid: boolean;
		error?: string;
	} {
		if (!name) {
			const error = ErrorHandler.createError(
				ErrorCode.GENERATOR_INVALID_STRUCTURE,
				'Generator name required',
				{},
				[
					{
						title: 'Provide generator name',
						description: 'Specify a name for your generator',
						command: 'hypergen init generator --name=my-generator',
					},
					{
						title: 'See more options',
						description: 'View all available options for generator creation',
						command: 'hypergen init generator --help',
					},
				],
			);
			return { valid: false, error: ErrorHandler.formatError(error) };
		}

		if (!/^[a-zA-Z][a-zA-Z0-9-_]*$/.test(name)) {
			const error = ErrorHandler.createParameterError(
				'name',
				name,
				'alphanumeric with dashes and underscores, starting with a letter',
			);
			return { valid: false, error: ErrorHandler.formatError(error) };
		}

		return { valid: true };
	}

	/**
	 * Build generator options from parameters
	 */
	private buildGeneratorOptions(
		parameters: Record<string, any>,
	): ScaffoldingOptions {
		return {
			name: parameters.name,
			description: parameters.description || `Generator for ${parameters.name}`,
			category: parameters.category || 'custom',
			author: parameters.author || 'Unknown',
			directory: parameters.directory || 'recipes',
			type: (parameters.type || 'both') as 'action' | 'template' | 'both',
			framework: (parameters.framework || 'generic') as
				| 'react'
				| 'vue'
				| 'node'
				| 'cli'
				| 'api'
				| 'generic',
			withExamples: parameters.withExamples !== 'false',
			withTests: parameters.withTests !== 'false',
		};
	}

	/**
	 * Validate generator options
	 */
	private validateGeneratorOptions(options: ScaffoldingOptions): {
		valid: boolean;
		error?: string;
	} {
		// Validate framework
		const validFrameworks = ['react', 'vue', 'node', 'cli', 'api', 'generic'];
		if (options.framework && !validFrameworks.includes(options.framework)) {
			const error = ErrorHandler.createParameterError(
				'framework',
				options.framework,
				`one of: ${validFrameworks.join(', ')}`,
			);
			return { valid: false, error: ErrorHandler.formatError(error) };
		}

		// Validate type
		const validTypes = ['action', 'template', 'both'];
		if (options.type && !validTypes.includes(options.type)) {
			const error = ErrorHandler.createParameterError(
				'type',
				options.type,
				`one of: ${validTypes.join(', ')}`,
			);
			return { valid: false, error: ErrorHandler.formatError(error) };
		}

		return { valid: true };
	}

	/**
	 * Format generator scaffolding result for display
	 */
	private formatGeneratorResult(
		result: InitResult,
		options: ScaffoldingOptions,
	): { success: boolean; message: string } {
		if (!result.success) {
			const error = ErrorHandler.createError(
				ErrorCode.GENERATOR_INVALID_STRUCTURE,
				result.message || 'Failed to create generator',
				{ action: 'init-generator' },
			);
			return {
				success: false,
				message: ErrorHandler.formatError(error),
			};
		}

		let message = `✅ Generator '${options.name}' created successfully\n`;
		message += `Location: ${options.directory || 'recipes'}/${options.name}\n`;
		message += `Files created: ${result.filesCreated?.length || 0}\n`;

		if (result.filesCreated && result.filesCreated.length > 0) {
			message += '\nFiles:\n';
			for (const file of result.filesCreated) {
				message += `  • ${file}\n`;
			}
		}

		message += '\nNext steps:\n';
		message += '  1. Edit the generator files to customize behavior\n';
		message += `  2. Test with: hypergen template validate ${options.directory || 'recipes'}/${options.name}/template.yml\n`;
		message += `  3. Run with: hypergen action ${options.name} --name=example\n`;

		return { success: true, message };
	}

	/**
	 * Initialize a new workspace
	 */
	private async initWorkspace(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const parameters = parseParameters(args);

		try {
			const options = this.buildWorkspaceOptions(parameters);

			// Execute scaffolding recipe
			const result = await this.scaffolding.initWorkspace(options);

			// Format and return result
			return this.formatWorkspaceResult(result, options);
		} catch (error: any) {
			return this.handleError(error, 'init-workspace');
		}
	}

	/**
	 * Build workspace options from parameters
	 */
	private buildWorkspaceOptions(
		parameters: Record<string, any>,
	): WorkspaceInitOptions {
		return {
			directory: parameters.directory || 'recipes',
			withExamples: parameters.withExamples !== 'false',
		};
	}

	/**
	 * Format workspace scaffolding result for display
	 */
	private formatWorkspaceResult(
		result: InitResult,
		options: WorkspaceInitOptions,
	): { success: boolean; message: string } {
		if (!result.success) {
			const error = ErrorHandler.createError(
				ErrorCode.GENERATOR_INVALID_STRUCTURE,
				result.message || 'Failed to initialize workspace',
				{ action: 'init-workspace' },
			);
			return {
				success: false,
				message: ErrorHandler.formatError(error),
			};
		}

		let message = '✅ Workspace initialized successfully\n';
		message += `Location: ${options.directory}\n`;
		message += `Files created: ${result.filesCreated?.length || 0}\n`;

		if (options.withExamples) {
			message += '\nExample generators created:\n';
			message += '  • component - React component generator\n';
			message += '  • api-route - API route generator\n';
			message += '  • util-function - Utility function generator\n';
		}

		message += '\nNext steps:\n';
		message += '  1. Explore the example generators\n';
		message +=
			'  2. Create your own: hypergen init generator --name=my-generator\n';
		message += '  3. List available generators: hypergen discover\n';
		message +=
			'  4. Run generators: hypergen action <generator-name> --name=example\n';

		return { success: true, message };
	}

	/**
	 * Handle errors with consistent formatting
	 */
	private handleError(
		error: any,
		action: string,
	): { success: boolean; message: string } {
		if (error instanceof HypergenError) {
			return {
				success: false,
				message: ErrorHandler.formatError(error),
			};
		}

		const hypergenError = ErrorHandler.createError(
			ErrorCode.GENERATOR_INVALID_STRUCTURE,
			error.message || `Failed to ${action}`,
			{ action },
		);
		return {
			success: false,
			message: ErrorHandler.formatError(hypergenError),
		};
	}
}
