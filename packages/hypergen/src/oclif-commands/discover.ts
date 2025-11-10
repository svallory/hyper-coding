import { Command, Flags } from '@oclif/core';
import { GeneratorDiscovery } from '../discovery/index.js';

export default class Discover extends Command {
	static description = 'Discover generators from all configured sources';

	static examples = [
		'<%= config.bin %> discover',
		'<%= config.bin %> discover --sources=npm,github',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
		sources: Flags.string({
			char: 's',
			description: 'Comma-separated list of sources to search',
			multiple: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Discover);

		const sources = flags.sources?.split(',');

		const discovery = sources
			? new GeneratorDiscovery({
					enabledSources: sources as any[],
				})
			: new GeneratorDiscovery();

		try {
			const generators = await discovery.discoverAll();

			// Register the discovered actions so they're available for execution
			await discovery.registerDiscoveredActions();

			this.log(
				`🔍 Discovery complete: found ${generators.length} generators\n`,
			);

			if (generators.length > 0) {
				this.log('Generators found:\n');

				for (const generator of generators) {
					this.log(`  📦 ${generator.name} (${generator.source})`);
					this.log(`     Path: ${generator.path}`);
					this.log(
						`     Actions: ${
							generator.actions.length > 0 ? generator.actions.join(', ') : 'none'
						}`,
					);

					if (generator.metadata?.description) {
						this.log(`     Description: ${generator.metadata.description}`);
					}

					this.log('');
				}
			} else {
				this.log('No generators found. Try:');
				this.log('  • Adding generators to recipes/ directory');
				this.log('  • Installing generator packages with npm');
				this.log('  • Using --sources to specify discovery sources');
			}
		} catch (error: any) {
			this.error(`❌ Discovery failed: ${error.message}`);
		}
	}
}
