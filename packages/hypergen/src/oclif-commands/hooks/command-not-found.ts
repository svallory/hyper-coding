import { Hook } from '@oclif/core';

/**
 * This hook intercepts unknown commands and treats them as cookbook names.
 *
 * When a user runs: hypergen starlight create
 * And "starlight" is not a known command, this hook will:
 * 1. Treat "starlight" as the cookbook name
 * 2. Treat "create" as the recipe name
 * 3. Re-route to the cookbook command
 */
const hook: Hook<'command_not_found'> = async function (opts) {
	const { id, argv } = opts;

	// If the unknown command looks like a cookbook invocation, handle it
	if (id && !id.includes(':')) {
		// id is the unknown command (e.g., "starlight")
		// argv contains remaining args (e.g., ["create", "--title=My Page"])

		this.log(`📚 Running cookbook: ${id}${argv.length > 0 ? ` ${argv[0]}` : ''}`);

		// Prepare arguments for cookbook command
		const cookbookArgs = [id, ...argv];

		// Execute the cookbook command
		const Cookbook = (await import('../cookbook.js')).default;
		await Cookbook.run(cookbookArgs, this.config);
		return;
	}

	// If we can't handle it, show the default error
	this.error(`Command ${id} not found. Run 'hypergen --help' for available commands.`);
};

export default hook;
