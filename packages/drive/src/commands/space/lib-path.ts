import { BaseCommand } from "#lib/base-command";
import { libPath } from "#services/space";

export default class LibPath extends BaseCommand<typeof LibPath> {
	static override description =
		"Print the absolute path of hyper-lib.sh, the shared bash space-detection library";

	static override examples = [
		"<%= config.bin %> space lib-path",
		// `| tail -n 1` is not decoration: toolchain shims (proto/mise/nvm)
		// print a one-off notice to STDOUT on first run under a new HOME, and
		// the plugin's scripts source this from a fresh environment. Copying
		// the bare form is the idiom that broke 51 assertions — take the last
		// line, which is the only one this command writes.
		'source "$(hyper space lib-path | tail -n 1)"',
	];

	static override flags = {
		...BaseCommand.baseFlags,
	};

	async run(): Promise<void> {
		await this.parse(LibPath);
		// Exactly one line and nothing else: the agent-plugin's scripts do
		// `source "$(hyper space lib-path | tail -n 1)"`, so any extra output
		// from this command would end up in a shell parse error. Noise from a
		// shim *above* it is the shim's to fix; callers defend with `tail -n 1`.
		this.log(libPath());
	}
}
