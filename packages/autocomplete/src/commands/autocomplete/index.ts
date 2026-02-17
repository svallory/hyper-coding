import { Args, Flags } from "@oclif/core";

import { indent, list } from "@hypercli/ui";
import { c, msg } from "@hypercli/ui/shortcuts";

import { AutocompleteBase } from "#base";
import Create from "#commands/autocomplete/create";

export default class Index extends AutocompleteBase {
	static override args = {
		shell: Args.string({
			description: "Shell type",
			options: ["zsh", "bash", "powershell"],
			required: false,
		}),
	};

	static override description = "Display autocomplete installation instructions.";

	static override examples = [
		"$ <%= config.bin %> autocomplete",
		"$ <%= config.bin %> autocomplete bash",
		"$ <%= config.bin %> autocomplete zsh",
		"$ <%= config.bin %> autocomplete powershell",
		"$ <%= config.bin %> autocomplete --refresh-cache",
	];

	static override flags = {
		"refresh-cache": Flags.boolean({
			char: "r",
			description: "Refresh cache (ignores displaying instructions)",
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Index);
		const shell = args.shell ?? this.determineShell(this.config.shell);

		await Create.run([], this.config);

		if (!flags["refresh-cache"]) {
			this.printShellInstructions(shell);
		}
	}

	private printShellInstructions(shell: string): void {
		const setupEnvVar = this.getSetupEnvVar(shell);
		const tabStr = shell === "bash" ? "<TAB><TAB>" : "<TAB>";
		const scriptCommand = `${this.config.bin} autocomplete script ${shell}`;

		this.log("Follow the steps below to enable autocomplete for your shell.\n");

		const steps: string[] = [];

		switch (shell) {
			case "bash": {
				steps.push(
					`Run this command in your terminal:\n\n${c.command(`printf "$(${scriptCommand})" >> ~/.bashrc; source ~/.bashrc`)}\n\nThis adds the ${c.command(setupEnvVar)} variable to your Bash config.\n\n${c.bold("NOTE")}: For login shells, use ${c.command("~/.bash_profile")} or ${c.command("~/.profile")} instead.`,
				);
				steps.push(
					`Start using autocomplete:\n\n${c.command(`${this.config.bin} ${tabStr}`)}                  # Command completion\n${c.command(`${this.config.bin} command --${tabStr}`)}        # Flag completion`,
				);
				break;
			}

			case "powershell": {
				steps.push(
					`Run these cmdlets in your PowerShell window:\n\n${c.command("New-Item -Type Directory -Path (Split-Path -Parent $PROFILE) -ErrorAction SilentlyContinue")}\n${c.command(`Add-Content -Path $PROFILE -Value (Invoke-Expression -Command "${scriptCommand}"); .$PROFILE`)}`,
				);
				steps.push(
					`(Optional) Enable menu completion:\n\n${c.command("Set-PSReadlineKeyHandler -Key Tab -Function MenuComplete")}`,
				);
				steps.push(
					`Start using autocomplete:\n\n${c.command(`${this.config.bin} ${tabStr}`)}                  # Command completion\n${c.command(`${this.config.bin} command --${tabStr}`)}        # Flag completion`,
				);
				break;
			}

			case "zsh": {
				steps.push(
					`Run this command in your terminal:\n\n${c.command(`printf "$(${scriptCommand})" >> ~/.zshrc; source ~/.zshrc`)}\n\nThis adds the ${c.command(setupEnvVar)} variable to your zsh config.`,
				);
				steps.push(`(Optional) Check for permission conflicts:\n\n${c.command("compaudit -D")}`);
				steps.push(
					`Start using autocomplete:\n\n${c.command(`${this.config.bin} ${tabStr}`)}                  # Command completion\n${c.command(`${this.config.bin} command --${tabStr}`)}        # Flag completion`,
				);
				break;
			}
		}

		this.log(indent(list(steps, { ordered: true })));
		this.log("");
		this.log(msg.success("Enjoy!"));
	}
}
