// src/cli/commands/list.ts

import type { ActionExecutor } from '../../actions/index.js';
import type { GeneratorDiscovery } from '../../discovery/index.js';

export class ListCommand {
	private executor: ActionExecutor;
	private discovery: GeneratorDiscovery;

	constructor(executor: ActionExecutor, discovery: GeneratorDiscovery) {
		this.executor = executor;
		this.discovery = discovery;
	}

	/**
	 * List available actions
	 * Usage: hypergen list [category]
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const [category] = args;

		try {
			// Auto-discover if no actions are available
			let actions = this.executor.getAvailableActionNames();
			if (actions.length === 0) {
				await this.discovery.discoverAll();
				await this.discovery.registerDiscoveredActions();
				actions = this.executor.getAvailableActionNames();
			}

			if (category) {
				actions = this.executor.getActionsByCategory(category);

				if (actions.length === 0) {
					return {
						success: false,
						message: `No actions found in category '${category}'. Available categories: ${this.executor
							.getCategories()
							.join(', ')}`,
					};
				}
			}

			if (actions.length === 0) {
				return {
					success: true,
					message:
						'📝 No actions available. Check that you have generators in recipes/ or run: hypergen discover',
				};
			}

			let message = category
				? `📝 Actions in category '${category}':\n`
				: '📝 Available actions:\n';

			for (const actionName of actions) {
				const info = this.executor.getActionInfo(actionName);
				message += `  • ${actionName}`;

				if (info.metadata?.description) {
					message += ` - ${info.metadata.description}`;
				}

				if (info.requiredParameters?.length) {
					message += ` (requires: ${info.requiredParameters.join(', ')})`;
				}

				message += '\n';
			}

			if (!category) {
				const categories = this.executor.getCategories();
				if (categories.length > 0) {
					message += `\n📂 Categories: ${categories.join(', ')}\n`;
					message += 'Use "hypergen list <category>" to filter by category\n';
				}
			}

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Failed to list actions: ${error.message}`,
			};
		}
	}
}
