import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createConfigFile, findProjectRoot } from "@hypercli/core";
import { Command, Flags } from "@oclif/core";

export default class Init extends Command {
	static override description = "Initialize Hyper in the current project";

	static override examples = [
		"<%= config.bin %> init",
		"<%= config.bin %> init --force",
		"<%= config.bin %> init --cwd ./my-project",
	];

	static override flags = {
		cwd: Flags.directory({
			description: "Working directory",
			default: process.cwd(),
		}),
		force: Flags.boolean({
			char: "f",
			description: "Overwrite existing configuration",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Init);
		const cwd = flags.cwd || process.cwd();

		// Detect project root (looks for package.json, git root, etc.)
		let projectRoot: string;
		try {
			const found = findProjectRoot(cwd);
			projectRoot = found.root;
		} catch {
			// No project root found — use cwd
			projectRoot = cwd;
		}

		const configPath = join(projectRoot, "hyper.config.js");
		const recipesDir = join(projectRoot, ".hyper", "recipes");
		const rel = (p: string) => relative(cwd, p) || ".";

		// Check if already initialized
		if (existsSync(configPath) && !flags.force) {
			this.log(`Already initialized — ${rel(configPath)} exists.`);
			this.log("Use --force to reinitialize.");
			return;
		}

		// Create config file
		if (flags.force && existsSync(configPath)) {
			// createConfigFile throws on existing file, so remove first
			const fs = await import("node:fs");
			fs.unlinkSync(configPath);
		}

		try {
			const created = await createConfigFile(projectRoot, "js");
			this.log(`  created  ${rel(created)}`);
		} catch (error) {
			this.error(
				`Failed to create config: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Create .hyper/recipes directory
		if (!existsSync(recipesDir)) {
			mkdirSync(recipesDir, { recursive: true });
			this.log(`  created  ${rel(recipesDir)}/`);
		}

		// Create a .gitkeep so the empty directory is tracked
		const gitkeep = join(recipesDir, ".gitkeep");
		if (!existsSync(gitkeep)) {
			const fs = await import("node:fs");
			fs.writeFileSync(gitkeep, "");
		}

		this.log("");
		this.log("Hyper initialized. Next steps:");
		this.log("  hyper kit install <kit>   Install a generator kit");
		this.log("  hyper recipe list         List available recipes");
		this.log("  hyper run <recipe>        Run a recipe");
	}
}
