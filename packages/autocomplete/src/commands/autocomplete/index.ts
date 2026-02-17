import { Args, Flags, ux } from "@oclif/core";

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

		ux.action.start(c.bold("Building the autocomplete cache"));
		await Create.run([], this.config);
		ux.action.stop();

		if (!flags["refresh-cache"]) {
			this.printShellInstructions(shell);
		}
	}

	private printShellInstructions(shell: string): void {
		const setupEnvVar = this.getSetupEnvVar(shell);
		const tabStr = shell === "bash" ? "<TAB><TAB>" : "<TAB>";
		const scriptCommand = `${this.config.bin} autocomplete script ${shell}`;

		this.log(
			msg.info({
				title: `Setup Instructions for ${this.config.bin.toUpperCase()} CLI Autocomplete`,
				summary: "Follow the steps below to enable autocomplete for your shell.",
				body: "",
			}),
		);

		switch (shell) {
			case "bash": {
				this.log(`
1) Run this command in your terminal window:

  ${c.command(`printf "$(${scriptCommand})" >> ~/.bashrc; source ~/.bashrc`)}

  The previous command adds the ${c.command(setupEnvVar)} environment variable to your Bash config file and then sources the file.

  ${c.bold("NOTE")}: If you've configured your terminal to start as a login shell, you may need to modify the command so it updates either the ~/.bash_profile or ~/.profile file. For example:

  ${c.command(`printf "$(${scriptCommand})" >> ~/.bash_profile; source ~/.bash_profile`)}

  Or:

  ${c.command(`printf "$(${scriptCommand})" >> ~/.profile; source ~/.profile`)}

2) Start using autocomplete:

  ${c.command(`${this.config.bin} ${tabStr}`)}                  # Command completion
  ${c.command(`${this.config.bin} command --${tabStr}`)}        # Flag completion
`);
				break;
			}

			case "powershell": {
				this.log(`
1) Run these two cmdlets in your PowerShell window in the order shown:

  ${c.command(`New-Item -Type Directory -Path (Split-Path -Parent $PROFILE) -ErrorAction SilentlyContinue
  Add-Content -Path $PROFILE -Value (Invoke-Expression -Command "${scriptCommand}"); .$PROFILE`)}

2) (Optional) If you want matching completions printed below the command line, run this cmdlet:

  ${c.command("Set-PSReadlineKeyHandler -Key Tab -Function MenuComplete")}

3) Start using autocomplete:

  ${c.command(`${this.config.bin} ${tabStr}`)}                  # Command completion
  ${c.command(`${this.config.bin} command --${tabStr}`)}        # Flag completion
`);
				break;
			}

			case "zsh": {
				this.log(`
1) Run this command in your terminal window:

  ${c.command(`printf "$(${scriptCommand})" >> ~/.zshrc; source ~/.zshrc`)}

  The previous command adds the ${c.command(setupEnvVar)} environment variable to your zsh config file and then sources the file.

2) (Optional) Run this command to ensure that you have no permissions conflicts:

  ${c.command("compaudit -D")}

3) Start using autocomplete:

  ${c.command(`${this.config.bin} ${tabStr}`)}                  # Command completion
  ${c.command(`${this.config.bin} command --${tabStr}`)}        # Flag completion
`);
				break;
			}
		}

		this.log(
			`  Every time you enter ${tabStr}, the autocomplete feature displays a list of commands (or flags if you type --), along with their summaries. Enter a letter and then ${tabStr} again to narrow down the list until you end up with the complete command that you want to execute.`,
		);
		this.log("");
		this.log(msg.success("Autocomplete is ready! Enjoy!"));
	}
}
