import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import makeDebug from "debug";

import { AutocompleteBase } from "#base";
import bashAutocompleteWithSpaces from "#completions/bash";
import PowerShellComp from "#completions/powershell";
import ZshCompWithSpaces from "#completions/zsh";

const debug = makeDebug("autocomplete:create");

interface CommandMeta {
	description: string;
	flags: Record<string, any>;
	id: string;
}

function sanitizeDescription(description: string | undefined): string {
	if (description === undefined) {
		return "";
	}

	return (
		description
			// backticks and double-quotes require triple-backslashes
			.replaceAll(/(["`])/g, "\\\\\\$1")
			// square brackets require double-backslashes
			.replaceAll(/([[\]])/g, "\\\\$1")
			// only use the first line
			.split("\n")[0]
	);
}

export default class Create extends AutocompleteBase {
	static override description = "create autocomplete setup scripts and completion functions";
	static override hidden = true;

	private _commands: CommandMeta[] | undefined;

	get bashCommandsWithFlagsList(): string {
		return this.commands
			.map((c) => {
				const publicFlags = this.genCmdPublicFlags(c).trim();
				return `${c.id} ${publicFlags}`;
			})
			.join("\n");
	}

	get bashCompletionFunction(): string {
		const { cliBin } = this;

		return (
			bashAutocompleteWithSpaces
				// eslint-disable-next-line unicorn/prefer-spread
				.concat(
					...(this.config.binAliases
						?.map((alias) => `complete -F _<CLI_BIN>_autocomplete ${alias}`)
						.join("\n") ?? []),
				)
				.replaceAll("<CLI_BIN>", cliBin)
				.replaceAll("<BASH_COMMANDS_WITH_FLAGS_LIST>", this.bashCommandsWithFlagsList)
		);
	}

	get bashCompletionFunctionPath(): string {
		return path.join(this.bashFunctionsDir, `${this.cliBin}.bash`);
	}

	get bashFunctionsDir(): string {
		return path.join(this.autocompleteCacheDir, "functions", "bash");
	}

	get bashSetupScript(): string {
		const setup = path.join(this.bashFunctionsDir, `${this.cliBin}.bash`);
		const bin = this.cliBinEnvVar;
		return `${bin}_AC_BASH_COMPFUNC_PATH=${setup} && test -f \$${bin}_AC_BASH_COMPFUNC_PATH && source \$${bin}_AC_BASH_COMPFUNC_PATH;\n`;
	}

	get bashSetupScriptPath(): string {
		return path.join(this.autocompleteCacheDir, "bash_setup");
	}

	get commands(): CommandMeta[] {
		if (this._commands) return this._commands;

		const cmds: CommandMeta[] = [];

		for (const p of this.config.getPluginsList()) {
			for (const c of p.commands) {
				try {
					if (c.hidden) continue;

					const description = sanitizeDescription(c.summary ?? (c.description || ""));
					const { flags } = c;

					cmds.push({ description, flags, id: c.id });

					for (const a of c.aliases) {
						cmds.push({ description, flags, id: a });
					}
				} catch (error) {
					debug(`Error creating zsh flag spec for command ${c.id}`);
					debug((error as Error).message);
					this.writeLogFile((error as Error).message);
				}
			}
		}

		this._commands = cmds;
		return this._commands;
	}

	get pwshCompletionFunctionPath(): string {
		return path.join(this.pwshFunctionsDir, `${this.cliBin}.ps1`);
	}

	get pwshFunctionsDir(): string {
		return path.join(this.autocompleteCacheDir, "functions", "powershell");
	}

	get zshCompletionFunctionPath(): string {
		return path.join(this.zshFunctionsDir, `_${this.cliBin}`);
	}

	get zshFunctionsDir(): string {
		return path.join(this.autocompleteCacheDir, "functions", "zsh");
	}

	get zshSetupScript(): string {
		return `\nfpath=(\n${this.zshFunctionsDir}\n$fpath\n);\nautoload -Uz compinit;\ncompinit;\n`;
	}

	get zshSetupScriptPath(): string {
		return path.join(this.autocompleteCacheDir, "zsh_setup");
	}

	async run(): Promise<void> {
		// Fix: parse args/flags to avoid the upstream oclif warning
		await this.parse(Create);

		// 1. ensure needed dirs
		await this.ensureDirs();
		// 2. save (generated) autocomplete files
		await this.createFiles();
	}

	private async createFiles(): Promise<void> {
		await Promise.all([
			writeFile(this.bashSetupScriptPath, this.bashSetupScript),
			writeFile(this.bashCompletionFunctionPath, this.bashCompletionFunction),
			writeFile(this.zshSetupScriptPath, this.zshSetupScript),
			writeFile(this.zshCompletionFunctionPath, new ZshCompWithSpaces(this.config).generate()),
			writeFile(this.pwshCompletionFunctionPath, new PowerShellComp(this.config).generate()),
		]);

		// Also rebuild dynamic cache for kit/cookbook/recipe completions
		try {
			const { DynamicCacheManager } = await import("#dynamic/cache");
			const projectRoot = this.findHyperRoot();
			if (projectRoot) {
				const cacheManager = new DynamicCacheManager(this.autocompleteCacheDir, projectRoot);
				await cacheManager.rebuild();
			}
		} catch (error) {
			debug("Failed to build dynamic cache: %s", error);
			// Don't fail — dynamic cache is optional
		}
	}

	private findHyperRoot(): string | null {
		let dir = process.cwd();
		const { root } = path.parse(dir);
		while (dir !== root) {
			if (fs.existsSync(path.join(dir, ".hyper"))) {
				return dir;
			}
			dir = path.dirname(dir);
		}
		return null;
	}

	private async ensureDirs(): Promise<void> {
		await mkdir(this.autocompleteCacheDir, { recursive: true });
		await Promise.all([
			mkdir(this.bashFunctionsDir, { recursive: true }),
			mkdir(this.zshFunctionsDir, { recursive: true }),
			mkdir(this.pwshFunctionsDir, { recursive: true }),
		]);
	}

	private genCmdPublicFlags(command: CommandMeta): string {
		const flags = command.flags || {};
		return Object.keys(flags)
			.filter((flag) => !flags[flag].hidden)
			.map((flag) => `--${flag}`)
			.join(" ");
	}
}
