import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown } from "@hypercli/core";
import { type Command, Help, type Interfaces } from "@oclif/core";
import { helpTheme } from "./theme.js";

export default class MarkdownHelp extends Help {
	async showCommandHelp(command: Command.Loadable): Promise<void> {
		const md = this.loadMarkdown(command);
		if (md) {
			this.log(renderMarkdown(md, helpTheme.theme));
			await this.showCommandSubInfo(command);
		} else {
			return super.showCommandHelp(command);
		}
	}

	protected async showRootHelp(): Promise<void> {
		const rootMd = this.loadRootMarkdown();
		if (rootMd) {
			this.log(renderMarkdown(rootMd, helpTheme.theme));
			const topLevelTopics = this.sortedTopics.filter((t) => !t.name.includes(":"));
			const topLevelCommands = this.sortedCommands.filter((c) => !c.id.includes(":"));
			if (topLevelTopics.length > 0) this.log(this.formatTopics(topLevelTopics));

			this.log("");

			if (topLevelCommands.length > 0) this.log(this.formatCommands(topLevelCommands));
		} else {
			return super.showRootHelp();
		}
	}

	protected async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
		const md = this.loadTopicMarkdown(topic);
		if (md) {
			this.log(renderMarkdown(md, helpTheme.theme));
			const depth = topic.name.split(":").length;
			const subTopics = this.sortedTopics.filter(
				(t) => t.name.startsWith(`${topic.name}:`) && t.name.split(":").length === depth + 1,
			);
			const subCommands = this.sortedCommands.filter(
				(c) => c.id.startsWith(`${topic.name}:`) && c.id.split(":").length === depth + 1,
			);
			if (subTopics.length > 0) this.log(this.formatTopics(subTopics));
			if (subCommands.length > 0) this.log(this.formatCommands(subCommands));
		} else {
			return super.showTopicHelp(topic);
		}
	}

	// --- Resolution helpers ---

	private loadMarkdown(command: Command.Loadable): string | null {
		const plugin = this.config.plugins.get(command.pluginName ?? "");
		const root = plugin?.root ?? this.config.root;
		const mdPath = `${join(root, "help", ...command.id.split(":"))}.md`;
		return this.readIfExists(mdPath);
	}

	private loadRootMarkdown(): string | null {
		return this.readIfExists(join(this.config.root, "help", "root.md"));
	}

	private loadTopicMarkdown(topic: Interfaces.Topic): string | null {
		// Check CLI root first
		const cliPath = `${join(this.config.root, "help", ...topic.name.split(":"))}.md`;
		if (existsSync(cliPath)) return readFileSync(cliPath, "utf-8");

		// Check all plugins
		for (const plugin of this.config.plugins.values()) {
			const pluginPath = `${join(plugin.root, "help", ...topic.name.split(":"))}.md`;
			if (existsSync(pluginPath)) return readFileSync(pluginPath, "utf-8");
		}
		return null;
	}

	private readIfExists(path: string): string | null {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	}

	private async showCommandSubInfo(command: Command.Loadable): Promise<void> {
		const name = command.id;
		const depth = name.split(":").length;
		const subTopics = this.sortedTopics.filter(
			(t) => t.name.startsWith(`${name}:`) && t.name.split(":").length === depth + 1,
		);
		const subCommands = this.sortedCommands.filter(
			(c) => c.id.startsWith(`${name}:`) && c.id.split(":").length === depth + 1,
		);
		if (subTopics.length > 0) this.log(this.formatTopics(subTopics));
		this.log("");
		if (subCommands.length > 0) this.log(this.formatCommands(subCommands));
	}
}
