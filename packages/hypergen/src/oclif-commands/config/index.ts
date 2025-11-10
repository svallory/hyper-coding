import { Command, Flags } from '@oclif/core';

export default class Config extends Command {
	static description = 'Manage Hypergen configuration';

	static examples = [
		'<%= config.bin %> config:init',
		'<%= config.bin %> config:show',
		'<%= config.bin %> config:validate',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
	};

	async run(): Promise<void> {
		this.log('Available config commands:');
		this.log('  - hypergen config:init     - Create configuration file');
		this.log('  - hypergen config:show     - Show current configuration');
		this.log('  - hypergen config:validate - Validate configuration');
		this.log('  - hypergen config:info     - Show configuration info');
	}
}
