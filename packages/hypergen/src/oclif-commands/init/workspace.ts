import { Command, Flags } from '@oclif/core';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import type { RunnerConfig } from '../../types.js';
import { GeneratorScaffolding } from '../../cli/scaffolding.js';

interface WorkspaceInitOptions {
	directory?: string;
	withExamples?: boolean;
}

interface InitResult {
	success: boolean;
	message?: string;
	filesCreated?: string[];
}

export default class InitWorkspace extends Command {
	static description = 'Initialize a new Hypergen workspace';

	static examples = [
		'<%= config.bin %> init:workspace',
		'<%= config.bin %> init:workspace --directory=recipes',
		'<%= config.bin %> init:workspace --no-with-examples',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
		directory: Flags.string({
			char: 'd',
			description: 'Output directory',
			default: 'recipes',
		}),
		'with-examples': Flags.boolean({
			description: 'Include example generators',
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
		const { flags } = await this.parse(InitWorkspace);

		const options: WorkspaceInitOptions = {
			directory: flags.directory,
			withExamples: flags['with-examples'],
		};

		try {
			const config: RunnerConfig = {
				cwd: process.cwd(),
				debug: flags.debug,
			};

			const scaffolding = new GeneratorScaffolding();
			const result = await scaffolding.initWorkspace(options);

			// Format and display result
			this.formatWorkspaceResult(result, options);
		} catch (error: any) {
			this.handleError(error, 'init-workspace');
		}
	}

	private formatWorkspaceResult(
		result: InitResult,
		options: WorkspaceInitOptions,
	): void {
		if (!result.success) {
			const error = ErrorHandler.createError(
				ErrorCode.GENERATOR_INVALID_STRUCTURE,
				result.message || 'Failed to initialize workspace',
				{ action: 'init-workspace' },
			);
			this.error(ErrorHandler.formatError(error));
		}

		this.log('✅ Workspace initialized successfully');
		this.log(`Location: ${options.directory}`);
		this.log(`Files created: ${result.filesCreated?.length || 0}`);

		if (options.withExamples) {
			this.log('\nExample generators created:');
			this.log('  • component - React component generator');
			this.log('  • api-route - API route generator');
			this.log('  • util-function - Utility function generator');
		}

		this.log('\nNext steps:');
		this.log('  1. Explore the example generators');
		this.log('  2. Create your own: hypergen init:generator --name=my-generator');
		this.log('  3. List available generators: hypergen discover');
		this.log(
			'  4. Run generators: hypergen action <generator-name> --name=example',
		);
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
