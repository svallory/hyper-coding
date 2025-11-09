// src/cli/commands/info.ts

import type { ActionExecutor } from '../../actions/index.js';
import type { GeneratorDiscovery } from '../../discovery/index.js';

export class InfoCommand {
	private executor: ActionExecutor;
	private discovery: GeneratorDiscovery;

	constructor(executor: ActionExecutor, discovery: GeneratorDiscovery) {
		this.executor = executor;
		this.discovery = discovery;
	}

	/**
	 * Show detailed action information
	 * Usage: hypergen info <action-name>
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		if (args.length === 0) {
			return {
				success: false,
				message: 'Action name required. Usage: hypergen info <action-name>',
			};
		}

		const [actionName] = args;
		let info = this.executor.getActionInfo(actionName);

		// Auto-discover if action not found
		if (!info.exists) {
			await this.discovery.discoverAll();
			await this.discovery.registerDiscoveredActions();
			info = this.executor.getActionInfo(actionName);
		}

		if (!info.exists) {
			return {
				success: false,
				message: `❌ Action '${actionName}' not found. Use 'hypergen list' to see available actions.`,
			};
		}

		let message = `📋 Action: ${actionName}
`;

		if (info.metadata?.description) {
			message += `Description: ${info.metadata.description}
`;
		}

		if (info.metadata?.category) {
			message += `Category: ${info.metadata.category}
`;
		}

		if (info.metadata?.tags?.length) {
			message += `Tags: ${info.metadata.tags.join(', ')}
`;
		}

		if (info.parameterCount && info.parameterCount > 0) {
			message += `
Parameters (${info.parameterCount}):
`;

			for (const param of info.metadata.parameters || []) {
				message += `  • ${param.name} (${param.type})`;

				if (param.required) {
					message += ' *required*';
				}

				if (param.default !== undefined) {
					message += ` [default: ${param.default}]`;
				}

				if (param.description) {
					message += ` - ${param.description}`;
				}

				message += '\n';
			}
		} else {
			message += '\nNo parameters required\n';
		}

		if (info.metadata?.examples?.length) {
			message += '\nExamples:\n';

			for (const example of info.metadata.examples) {
				message += `  ${example.title}:
`;
				message += `    hypergen action ${actionName}`;

				for (const [key, value] of Object.entries(example.parameters)) {
					message += ` --${key}=${value}`;
				}

				message += '\n';

				if (example.description) {
					message += `    ${example.description}
`;
				}

				message += '\n';
			}
		}

		return { success: true, message };
	}
}
