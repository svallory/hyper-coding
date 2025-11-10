import { Command, Flags, Args } from '@oclif/core';
import { ActionExecutor } from '../actions/index.js';
import { GeneratorDiscovery } from '../discovery/index.js';

export default class Info extends Command {
	static description = 'Show detailed information about an action';

	static examples = [
		'<%= config.bin %> info my-action',
		'<%= config.bin %> info component',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
	};

	static args = {
		action: Args.string({
			name: 'action',
			required: true,
			description: 'Action name to get information about',
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(Info);

		const executor = new ActionExecutor();
		const discovery = new GeneratorDiscovery();

		let info = executor.getActionInfo(args.action);

		// Auto-discover if action not found
		if (!info.exists) {
			await discovery.discoverAll();
			await discovery.registerDiscoveredActions();
			info = executor.getActionInfo(args.action);
		}

		if (!info.exists) {
			this.error(
				`❌ Action '${args.action}' not found. Use 'hypergen list' to see available actions.`,
			);
		}

		this.log(`📋 Action: ${args.action}`);

		if (info.metadata?.description) {
			this.log(`Description: ${info.metadata.description}`);
		}

		if (info.metadata?.category) {
			this.log(`Category: ${info.metadata.category}`);
		}

		if (info.metadata?.tags?.length) {
			this.log(`Tags: ${info.metadata.tags.join(', ')}`);
		}

		if (info.parameterCount && info.parameterCount > 0) {
			this.log(`\nParameters (${info.parameterCount}):`);

			for (const param of info.metadata.parameters || []) {
				let line = `  • ${param.name} (${param.type})`;

				if (param.required) {
					line += ' *required*';
				}

				if (param.default !== undefined) {
					line += ` [default: ${param.default}]`;
				}

				if (param.description) {
					line += ` - ${param.description}`;
				}

				this.log(line);
			}
		} else {
			this.log('\nNo parameters required');
		}

		if (info.metadata?.examples?.length) {
			this.log('\nExamples:');

			for (const example of info.metadata.examples) {
				this.log(`  ${example.title}:`);
				let command = `    hypergen action ${args.action}`;

				for (const [key, value] of Object.entries(example.parameters)) {
					command += ` --${key}=${value}`;
				}

				this.log(command);

				if (example.description) {
					this.log(`    ${example.description}`);
				}

				this.log('');
			}
		}
	}
}
