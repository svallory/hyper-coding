import { Command, Flags } from '@oclif/core';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import type { RunnerConfig } from '../../types.js';
import type { ScaffoldingOptions } from '../../cli/scaffolding.js';
import { GeneratorScaffolding } from '../../cli/scaffolding.js';

interface InitResult {
	success: boolean;
	message?: string;
	filesCreated?: string[];
}

export default class InitGenerator extends Command {
	static description = 'Initialize a new generator';

	static examples = [
		'<%= config.bin %> init:generator --name=my-generator',
		'<%= config.bin %> init:generator --name=my-generator --description="My custom generator"',
		'<%= config.bin %> init:generator --name=my-generator --framework=react --type=both',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
		name: Flags.string({
			char: 'n',
			description: 'Generator name',
			required: true,
		}),
		description: Flags.string({
			char: 'd',
			description: 'Generator description',
		}),
		category: Flags.string({
			char: 'c',
			description: 'Generator category',
			default: 'custom',
		}),
		author: Flags.string({
			char: 'a',
			description: 'Generator author',
			default: 'Unknown',
		}),
		directory: Flags.string({
			description: 'Output directory',
			default: 'recipes',
		}),
		type: Flags.string({
			char: 't',
			description: 'Generator type',
			options: ['action', 'template', 'both'],
			default: 'both',
		}),
		framework: Flags.string({
			char: 'f',
			description: 'Target framework',
			options: ['react', 'vue', 'node', 'cli', 'api', 'generic'],
			default: 'generic',
		}),
		'with-examples': Flags.boolean({
			description: 'Include example files',
			default: true,
			allowNo: true,
		}),
		'with-tests': Flags.boolean({
			description: 'Include test files',
			default: true,
			allowNo: true,
		}),
		debug: Flags.boolean({
			description: 'Enable debug mode',
			default: false,
		}),
		verbose: Flags.boolean({
			char: 'v',
			description: 'Enable verbose output',
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(InitGenerator);

		// Validate name
		const nameValidation = this.validateGeneratorName(flags.name);
		if (!nameValidation.valid) {
			this.error(nameValidation.error!);
		}

		// Build options
		const options: ScaffoldingOptions = {
			name: flags.name,
			description: flags.description || `Generator for ${flags.name}`,
			category: flags.category,
			author: flags.author,
			directory: flags.directory,
			type: flags.type as 'action' | 'template' | 'both',
			framework: flags.framework as
				| 'react'
				| 'vue'
				| 'node'
				| 'cli'
				| 'api'
				| 'generic',
			withExamples: flags['with-examples'],
			withTests: flags['with-tests'],
		};

		// Validate options
		const optionsValidation = this.validateGeneratorOptions(options);
		if (!optionsValidation.valid) {
			this.error(optionsValidation.error!);
		}

		try {
			const config: RunnerConfig = {
				cwd: process.cwd(),
				debug: flags.debug,
			};

			const scaffolding = new GeneratorScaffolding();
			const result = await scaffolding.initGenerator(options);

			// Format and display result
			this.formatGeneratorResult(result, options);
		} catch (error: any) {
			this.handleError(error, 'init-generator');
		}
	}

	private validateGeneratorName(name: string): {
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
						command: 'hypergen init:generator --name=my-generator',
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

	private formatGeneratorResult(
		result: InitResult,
		options: ScaffoldingOptions,
	): void {
		if (!result.success) {
			const error = ErrorHandler.createError(
				ErrorCode.GENERATOR_INVALID_STRUCTURE,
				result.message || 'Failed to create generator',
				{ action: 'init-generator' },
			);
			this.error(ErrorHandler.formatError(error));
		}

		this.log(`✅ Generator '${options.name}' created successfully`);
		this.log(`Location: ${options.directory || 'recipes'}/${options.name}`);
		this.log(`Files created: ${result.filesCreated?.length || 0}`);

		if (result.filesCreated && result.filesCreated.length > 0) {
			this.log('\nFiles:');
			for (const file of result.filesCreated) {
				this.log(`  • ${file}`);
			}
		}

		this.log('\nNext steps:');
		this.log('  1. Edit the generator files to customize behavior');
		this.log(
			`  2. Test with: hypergen template validate ${options.directory || 'recipes'}/${options.name}/template.yml`,
		);
		this.log(`  3. Run with: hypergen action ${options.name} --name=example`);
	}

	private handleError(error: any, action: string): void {
		if (error instanceof HypergenError) {
			this.error(ErrorHandler.formatError(error));
		}

		const hypergenError = ErrorHandler.createError(
			ErrorCode.GENERATOR_INVALID_STRUCTURE,
			error.message || `Failed to ${action}`,
			{ action },
		);
		this.error(ErrorHandler.formatError(hypergenError));
	}
}
