import type { Config } from "@oclif/core";

import type { CommandCompletion, FlagCompletion, TopicCompletion } from "./types.js";

/**
 * Base class for shell completion script generators.
 * Contains shared logic for extracting commands and topics from oclif config.
 */
export abstract class CompletionScriptBase {
	config: Config;
	commands: CommandCompletion[];
	topics: TopicCompletion[];

	private _coTopics: string[] | undefined;

	constructor(config: Config) {
		this.config = config;
		this.topics = this.getTopics();
		this.commands = this.getCommands();
	}

	get coTopics(): string[] {
		if (this._coTopics) return this._coTopics;

		const coTopics: string[] = [];
		for (const topic of this.topics) {
			for (const cmd of this.commands) {
				if (topic.name === cmd.id) {
					coTopics.push(topic.name);
				}
			}
		}

		this._coTopics = coTopics;
		return this._coTopics;
	}

	abstract generate(): string;
	abstract sanitizeSummary(summary: string | undefined): string;

	getCommands(): CommandCompletion[] {
		const cmds: CommandCompletion[] = [];

		for (const p of this.config.getPluginsList()) {
			for (const c of p.commands) {
				if (c.hidden) continue;

				const summary = this.sanitizeSummary(c.summary ?? c.description);
				const { flags } = c;

				cmds.push({
					flags: flags as unknown as Record<string, FlagCompletion>,
					id: c.id,
					summary,
				});

				for (const a of c.aliases) {
					cmds.push({
						flags: flags as unknown as Record<string, FlagCompletion>,
						id: a,
						summary,
					});

					const split = a.split(":");
					let topic = split[0];

					for (let i = 0; i < split.length - 1; i++) {
						if (!this.topics.some((t) => t.name === topic)) {
							this.topics.push({
								description: `${topic.replaceAll(":", " ")} commands`,
								name: topic,
							});
						}

						topic += `:${split[i + 1]}`;
					}
				}
			}
		}

		return cmds;
	}

	getTopics(): TopicCompletion[] {
		const topics = this.config.topics
			.filter((topic) => {
				const hasChild = this.config.topics.some((subTopic) =>
					subTopic.name.includes(`${topic.name}:`),
				);
				return hasChild;
			})
			.sort((a, b) => {
				if (a.name < b.name) return -1;
				if (a.name > b.name) return 1;
				return 0;
			})
			.map((t) => {
				const description = t.description
					? this.sanitizeSummary(t.description)
					: `${t.name.replaceAll(":", " ")} commands`;
				return {
					description,
					name: t.name,
				};
			});

		return topics;
	}
}
