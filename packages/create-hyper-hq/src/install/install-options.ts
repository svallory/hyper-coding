export interface InstallOption {
	label: string;
	value: string;
	command?: string;
	args?: string[];
	sudo?: boolean;
	hint?: string;
}

export interface InstallContext {
	callingPm: string;
	availableNodePms: string[];
	systemPms: string[];
	os: "macos" | "linux" | "windows";
	isRoot: boolean;
}

const MANUAL_OPTION: InstallOption = {
	label: "I'll install it myself and let you know",
	value: "manual",
};

const CANCEL_OPTION: InstallOption = {
	label: "Cancel",
	value: "cancel",
};

function nodePmInstallOption(pm: string, pkg: string): InstallOption {
	const installArg = pm === "yarn" ? "global add" : "install -g";
	const args = [...installArg.split(" "), pkg];
	return {
		label: `${pm} ${installArg} ${pkg}`,
		value: pm,
		command: pm,
		args,
		sudo: false,
	};
}

export function getInstallOptions(
	tool: "hyper" | "claude" | "tmux",
	context: InstallContext,
): InstallOption[] {
	const { callingPm, availableNodePms, systemPms, os, isRoot } = context;
	const options: InstallOption[] = [];

	if (tool === "hyper") {
		// Calling PM first, then others
		const pmsOrdered = [callingPm, ...availableNodePms.filter((pm) => pm !== callingPm)];

		for (const pm of pmsOrdered) {
			options.push(nodePmInstallOption(pm, "@hypercli/cli"));
		}
	} else if (tool === "claude") {
		// Native installer first (recommended)
		if (os !== "windows") {
			options.push({
				label: "curl -fsSL https://claude.ai/install.sh | bash  (recommended, auto-updates)",
				value: "native",
				command: "bash",
				args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
				sudo: false,
				hint: "recommended, auto-updates",
			});
		}

		// Brew cask if available
		if (systemPms.includes("brew")) {
			options.push({
				label: "brew install --cask claude-code",
				value: "brew",
				command: "brew",
				args: ["install", "--cask", "claude-code"],
				sudo: false,
			});
		}

		// npm (deprecated)
		if (availableNodePms.includes("npm")) {
			options.push({
				label: "npm install -g @anthropic-ai/claude-code  (deprecated)",
				value: "npm",
				command: "npm",
				args: ["install", "-g", "@anthropic-ai/claude-code"],
				sudo: false,
				hint: "deprecated",
			});
		}
	} else if (tool === "tmux") {
		if (os === "macos") {
			if (systemPms.includes("brew")) {
				options.push({
					label: "brew install tmux",
					value: "brew",
					command: "brew",
					args: ["install", "tmux"],
					sudo: false,
				});
			}

			if (systemPms.includes("port")) {
				options.push({
					label: isRoot ? "port install tmux" : "sudo port install tmux",
					value: "port",
					command: isRoot ? "port" : "sudo",
					args: isRoot ? ["install", "tmux"] : ["port", "install", "tmux"],
					sudo: !isRoot,
				});
			}
		} else if (os === "linux") {
			const linuxPmOptions: Array<{ pm: string; cmd: string; args: string[] }> = [
				{ pm: "apt", cmd: "apt", args: ["install", "-y", "tmux"] },
				{ pm: "dnf", cmd: "dnf", args: ["install", "-y", "tmux"] },
				{ pm: "pacman", cmd: "pacman", args: ["-S", "--noconfirm", "tmux"] },
				{ pm: "apk", cmd: "apk", args: ["add", "tmux"] },
				{ pm: "zypper", cmd: "zypper", args: ["install", "-y", "tmux"] },
			];

			for (const { pm, cmd, args } of linuxPmOptions) {
				if (systemPms.includes(pm)) {
					const needsSudo = !isRoot;
					options.push({
						label: needsSudo ? `sudo ${cmd} ${args.join(" ")}` : `${cmd} ${args.join(" ")}`,
						value: pm,
						command: needsSudo ? "sudo" : cmd,
						args: needsSudo ? [cmd, ...args] : args,
						sudo: needsSudo,
					});
				}
			}
		}

		// conda available on any OS
		if (systemPms.includes("conda")) {
			options.push({
				label: "conda install -c conda-forge tmux",
				value: "conda",
				command: "conda",
				args: ["install", "-c", "conda-forge", "tmux"],
				sudo: false,
			});
		}
	}

	options.push(MANUAL_OPTION, CANCEL_OPTION);
	return options;
}
