import { Flags } from "@oclif/core";
import { loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { listProjects } from "#services/projects";

export default class List extends BaseCommand<typeof List> {
	static override description = "List available projects and their worktrees";

	static override examples = [
		"<%= config.bin %> hq list",
		"<%= config.bin %> hq list --json",
		"<%= config.bin %> hq list --root /path/to/projects",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		root: Flags.string({ description: "Override projects root directory" }),
		json: Flags.boolean({ description: "Output as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(List);
		const config = loadConfig();

		if (flags.root) {
			config.projects_root = flags.root;
		}

		const projects = listProjects(config);

		if (flags.json) {
			this.log(JSON.stringify(projects, null, 2));
			return;
		}

		this.log(`Projects (${config.projects_root})`);
		this.log("─".repeat(50));

		if (projects.length === 0) {
			this.log("  No projects found");
			return;
		}

		for (const project of projects) {
			const tags: string[] = [];
			if (project.isGit) tags.push("git");
			if (project.hasWorktrees) tags.push(`${project.worktrees.length} worktrees`);
			const tagStr = tags.length > 0 ? `  (${tags.join(", ")})` : "";

			this.log(`  ${project.name}${tagStr}`);

			if (project.hasWorktrees) {
				for (let i = 0; i < project.worktrees.length; i++) {
					const wt = project.worktrees[i]!;
					const isLast = i === project.worktrees.length - 1;
					const prefix = isLast ? "└─" : "├─";
					const mainTag = wt.isMain ? " *" : "";
					this.log(`    ${prefix} ${wt.branch}${mainTag}  ${wt.path}`);
				}
			}
		}
	}
}
