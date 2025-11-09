// src/cli/commands/discover.ts

import { GeneratorDiscovery } from '../../discovery/index.js';

export class DiscoverCommand {
	private discovery: GeneratorDiscovery;

	constructor(discovery: GeneratorDiscovery) {
		this.discovery = discovery;
	}

	/**
	 * Discover generators from all sources
	 * Usage: hypergen discover [sources...]
	 */
	async execute(
		args: string[],
	): Promise<{ success: boolean; message?: string }> {
		const sources = args.length > 0 ? args : undefined;

		if (sources) {
			this.discovery = new GeneratorDiscovery({
				enabledSources: sources as any[],
			});
		}

		try {
			const generators = await this.discovery.discoverAll();

			// Register the discovered actions so they're available for execution
			await this.discovery.registerDiscoveredActions();

			let message = `🔍 Discovery complete: found ${generators.length} generators\n`;

			if (generators.length > 0) {
				message += '\nGenerators found:\n';

				for (const generator of generators) {
					message += `  📦 ${generator.name} (${generator.source})\n`;
					message += `     Path: ${generator.path}\n`;
					message += `     Actions: ${
						generator.actions.length > 0 ? generator.actions.join(', ') : 'none'
					}\n`;

					if (generator.metadata?.description) {
						message += `     Description: ${generator.metadata.description}\n`;
					}

					message += '\n';
				}
			} else {
				message += '\nNo generators found. Try:\n';
				message += '  • Adding generators to recipes/ directory\n';
				message += '  • Installing generator packages with npm\n';
				message += '  • Using --sources to specify discovery sources\n';
			}

			return { success: true, message };
		} catch (error: any) {
			return {
				success: false,
				message: `❌ Discovery failed: ${error.message}`,
			};
		}
	}
}
