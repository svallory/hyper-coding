/**
 * Uninstall/remove a kit
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { c, msg, s } from "@hypercli/ui";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#base-command";
import { getKitFromManifest, removeKitFromManifest } from "#manifest";

export default class KitUninstall extends BaseCommand<typeof KitUninstall> {
	static override description = "Remove an installed kit";

	static override aliases = ["kit:remove"];

	static override examples = [
		"<%= config.bin %> kit uninstall starlight",
		"<%= config.bin %> kit uninstall starlight --force",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		force: Flags.boolean({
			char: "f",
			description: "Skip confirmation prompt",
			default: false,
		}),
	};

	static override args = {
		kit: Args.string({
			description: "Name of the kit to uninstall",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(KitUninstall);
		await this.resolveEffectiveCwd(flags);

		const projectRoot = flags.cwd;
		const kitName = args.kit;

		const entry = getKitFromManifest(projectRoot, kitName);
		if (!entry) {
			this.log(msg.error(`Kit not found: ${kitName}`));
			this.log(`\n  Run ${c.command("hyper kit list")} to see installed kits.\n`);
			this.exit(1);
		}

		// Confirmation unless --force
		if (!flags.force) {
			const { confirm } = await import("@clack/prompts");
			const confirmed = await confirm({
				message: `Remove kit ${c.kit(kitName)}?`,
			});
			if (!confirmed || typeof confirmed === "symbol") {
				this.log(s.info("Cancelled."));
				return;
			}
		}

		// Remove based on type
		if (entry.type === "npm" || entry.type === "jsr") {
			// Package manager removal
			const pm = this.detectPackageManager();
			const removeCmd = pm === "yarn" ? "remove" : "uninstall";
			const cmd = `${pm} ${removeCmd} ${entry.source}`;
			this.log(s.info(`Running: ${cmd}`));
			const { execSync } = await import("node:child_process");
			try {
				execSync(cmd, { cwd: projectRoot, stdio: "inherit" });
			} catch {
				this.log(msg.error(`Failed to run: ${cmd}`));
			}
		} else {
			// Local/git/github — remove directory
			const kitDir = join(projectRoot, ".hyper", "kits", kitName);
			if (existsSync(kitDir)) {
				rmSync(kitDir, { recursive: true, force: true });
			}
		}

		removeKitFromManifest(projectRoot, kitName);
		this.log(s.success(`Kit ${c.kit(kitName)} has been removed.`));
	}
}
