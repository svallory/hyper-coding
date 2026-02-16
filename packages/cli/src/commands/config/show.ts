import { spawn } from "node:child_process";
import { HypergenConfigLoader } from "@hypercli/core";
import { Command, Flags } from "@oclif/core";
import chalk from "chalk";

export default class ConfigShow extends Command {
	static override description = "Show the resolved Hypergen configuration";

	static override examples = [
		"<%= config.bin %> config show",
		"<%= config.bin %> config show --json",
	];

	static override flags = {
		json: Flags.boolean({
			description: "Output raw JSON (no interactive viewer)",
			default: false,
		}),
		cwd: Flags.directory({
			description: "Working directory",
			default: process.cwd(),
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(ConfigShow);
		const cwd = flags.cwd || process.cwd();

		const config = await HypergenConfigLoader.loadConfig(undefined, cwd);

		const json = JSON.stringify(config, null, 2);

		if (flags.json) {
			this.log(json);
			return;
		}

		// Try to open in fx interactive viewer
		const opened = await this.openInFx(json);
		if (!opened) {
			// Fallback: print with basic syntax coloring
			this.log(colorizeJson(json));
		}
	}

	private openInFx(json: string): Promise<boolean> {
		return new Promise((resolve) => {
			const child = spawn("fx", [], {
				stdio: ["pipe", "inherit", "inherit"],
			});

			child.on("error", () => {
				// fx not available
				resolve(false);
			});

			child.on("close", (code) => {
				resolve(code === 0);
			});

			child.stdin.write(json);
			child.stdin.end();
		});
	}
}

/**
 * Basic JSON syntax coloring fallback when fx is not available.
 */
function colorizeJson(json: string): string {
	return json
		.replace(/("(?:[^"\\]|\\.)*")\s*:/g, (_, key) => `${chalk.cyan(key)}:`)
		.replace(/:\s*("(?:[^"\\]|\\.)*")/g, (match, val) => match.replace(val, chalk.green(val)))
		.replace(/:\s*(\d+(?:\.\d+)?)/g, (match, num) => match.replace(num, chalk.yellow(num)))
		.replace(/:\s*(true|false|null)\b/g, (match, lit) => match.replace(lit, chalk.magenta(lit)));
}
