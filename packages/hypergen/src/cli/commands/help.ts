// src/cli/commands/help.ts

import { ActionRegistry } from '../../actions/registry.js';
import type { TemplateURLManager } from '../../config/url-resolution/index.js';
import type { GeneratorDiscovery } from '../../discovery/index.js';
import type { RunnerConfig } from '../../types.js';

export class HelpCommand {
	private discovery: GeneratorDiscovery;
	private urlManager: TemplateURLManager;
	private config: RunnerConfig;

	constructor(
		discovery: GeneratorDiscovery,
		urlManager: TemplateURLManager,
		config: RunnerConfig,
	) {
		this.discovery = discovery;
		this.urlManager = urlManager;
		this.config = config;
	}

	/**
	 * Show system help
	 */
	async execute(): Promise<{
		success: boolean;
		message?: string;
	}> {
		const message = `
🚀 Hypergen Commands

Core Commands:
  hypergen init <type> [options]        Initialize a new generator or workspace
  hypergen discover [sources...]        Discover generators from sources
  hypergen list [category]              List available actions
  hypergen info <action-name>           Show detailed action information
  hypergen config <subcommand> [args]   Manage Hypergen's configuration files
  hypergen template <subcommand> [args] Manage and inspect Hypergen template files

Recipe System (V8):
  hypergen cookbook [RECIPE] [options]  Run a recipe from the cookbook

System Information:
  hypergen help                         Show this help message
  hypergen version                      Show version information

Flags:
  --dryRun                             Run without making file changes
  --force                              Force overwrite existing files
  --skipPrompts                        Use defaults, skip interactive prompts
  --continueOnError                    Continue execution after step failures

Examples:
  hypergen init generator --name=my-component --framework=react
  hypergen discover
  hypergen list component
  hypergen info create-component
  hypergen config show
  hypergen template validate recipes/my-component/template.yml
  hypergen cookbook my-recipe.yml --name=Button --typescript=true
`;

		return { success: true, message };
	}
}
