import { Command, Flags } from '@oclif/core';
import {
	HypergenConfigLoader,
	createConfigFile,
} from '../../config/hypergen-config.js';

export default class Init extends Command {
	static description = 'Initialize Hypergen in the current project';

	static examples = [
		'<%= config.bin %> init',
		'<%= config.bin %> init --format=json',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
		format: Flags.string({
			char: 'f',
			description: 'Configuration file format',
			options: ['js', 'json'],
			default: 'js',
		}),
		force: Flags.boolean({
			description: 'Overwrite existing configuration',
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Init);

		try {
			// Find project root (walk up to find package.json)
			const projectRoot = process.cwd(); // TODO: Implement proper root finding with monorepo support

			// Check if config already exists
			const existingConfig = await HypergenConfigLoader.loadConfig(
				undefined,
				projectRoot,
			).catch(() => null);

			if (existingConfig && !flags.force) {
				this.error(
					'Hypergen is already initialized in this project. Use --force to overwrite.',
				);
			}

			// Create configuration file
			const configPath = await createConfigFile(
				projectRoot,
				flags.format as 'js' | 'json',
			);

			this.log(`✅ Hypergen initialized successfully`);
			this.log(`Configuration file created: ${configPath}`);
			this.log('\nNext steps:');
			this.log('  1. Edit the configuration file to match your needs');
			this.log('  2. Install cookbooks: npm install @hyper-kits/starlight');
			this.log('  3. Run a recipe: hypergen starlight create');
		} catch (error: any) {
			this.error(`Failed to initialize Hypergen: ${error.message}`);
		}
	}
}
