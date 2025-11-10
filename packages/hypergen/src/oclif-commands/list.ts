import { Command, Flags } from '@oclif/core';
import { ActionExecutor } from '../actions/index.js';
import { GeneratorDiscovery } from '../discovery/index.js';

export default class List extends Command {
	static description = 'List available actions';

	static examples = [
		'<%= config.bin %> list',
		'<%= config.bin %> list --category=react',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
		category: Flags.string({
			char: 'c',
			description: 'Filter by category',
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(List);

		const executor = new ActionExecutor();
		const discovery = new GeneratorDiscovery();

		try {
			// Auto-discover if no actions are available
			let actions = executor.getAvailableActionNames();
			if (actions.length === 0) {
				await discovery.discoverAll();
				await discovery.registerDiscoveredActions();
				actions = executor.getAvailableActionNames();
			}

			if (flags.category) {
				actions = executor.getActionsByCategory(flags.category);

				if (actions.length === 0) {
					this.error(
						`No actions found in category '${flags.category}'. Available categories: ${executor
							.getCategories()
							.join(', ')}`,
					);
				}
			}

			if (actions.length === 0) {
				this.log(
					'📝 No actions available. Check that you have generators in recipes/ or run: hypergen discover',
				);
				return;
			}

			this.log(
				flags.category
					? `📝 Actions in category '${flags.category}':\n`
					: '📝 Available actions:\n',
			);

			for (const actionName of actions) {
				const info = executor.getActionInfo(actionName);
				let line = `  • ${actionName}`;

				if (info.metadata?.description) {
					line += ` - ${info.metadata.description}`;
				}

				if (info.requiredParameters?.length) {
					line += ` (requires: ${info.requiredParameters.join(', ')})`;
				}

				this.log(line);
			}

			if (!flags.category) {
				const categories = executor.getCategories();
				if (categories.length > 0) {
					this.log(`\n📂 Categories: ${categories.join(', ')}`);
					this.log('Use "hypergen list --category=<category>" to filter');
				}
			}
		} catch (error: any) {
			this.error(`❌ Failed to list actions: ${error.message}`);
		}
	}
}
