import { BaseCommand } from "#lib/base-command";
import { libPath } from "#services/space";

export default class LibPath extends BaseCommand<typeof LibPath> {
	static override description =
		"Print the absolute path of hyper-lib.sh, the shared bash space-detection library";

	static override examples = [
		"<%= config.bin %> space lib-path",
		'source "$(hyper space lib-path)"',
	];

	static override flags = {
		...BaseCommand.baseFlags,
	};

	async run(): Promise<void> {
		await this.parse(LibPath);
		// Exactly one line and nothing else: the agent-plugin's scripts do
		// `source "$(hyper space lib-path)"`, so any extra output would end up
		// in a shell parse error. Keep it silent.
		this.log(libPath());
	}
}
