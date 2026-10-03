import { statSync } from "node:fs";
import { resolve } from "node:path";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { detectSpace } from "#services/space";

export default class Detect extends BaseCommand<typeof Detect> {
	static override description =
		"Report which hyper space a directory belongs to (root, layout, repos)";

	static override examples = [
		"<%= config.bin %> space detect",
		"<%= config.bin %> space detect ../notes",
		"<%= config.bin %> space detect --json",
	];

	static override args = {
		dir: Args.string({
			description: "Directory to inspect (defaults to the current directory)",
			required: false,
		}),
	};

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Print the result as JSON",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Detect);

		const dir = resolve(args.dir ?? process.cwd());
		if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
			this.error(`There's no directory at ${dir}`, { exit: 1 });
		}

		const info = detectSpace(dir);
		if (info.root === null || info.layout === null) {
			// Machine callers asked for JSON, so give them JSON on stdout even in
			// the failure case — otherwise `hyper space detect --json | jq` dies on
			// an empty stream instead of reading nulls. The prose stays on stderr
			// (oclif's error channel) and the exit code is still 1, so nothing
			// that branches on the status changes.
			if (flags.json) {
				this.log(JSON.stringify({ root: null, layout: null }, null, 2));
			}
			// One clear sentence beats printing nulls: the answer itself is the
			// useful part, and scripts branch on the exit code.
			this.error(
				`${dir} is not inside a hyper space (no bare or multi-repo space root above it).`,
				{ exit: 1 },
			);
		}

		if (flags.json) {
			this.log(JSON.stringify(info, null, 2));
			return;
		}

		this.log(`root:         ${info.root}`);
		this.log(`layout:       ${info.layout}`);
		this.log(`slug:         ${info.slug ?? "-"}`);
		this.log(`worktrees:    ${info.worktreesDir ?? "-"}`);
		this.log(`repos:        ${info.repos.length > 0 ? info.repos.join(", ") : "-"}`);
	}
}
