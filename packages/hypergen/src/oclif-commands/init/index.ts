import { Command, Flags } from '@oclif/core';

export default class Init extends Command {
	static description = 'Initialize Hypergen workspace or generator';

	static examples = [
		'<%= config.bin %> init:generator --name=my-generator',
		'<%= config.bin %> init:workspace --directory=recipes',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
	};

	async run(): Promise<void> {
		this.log('Available init commands:');
		this.log('  - hypergen init:generator - Create a new generator');
		this.log('  - hypergen init:workspace - Initialize a new workspace');
	}
}
