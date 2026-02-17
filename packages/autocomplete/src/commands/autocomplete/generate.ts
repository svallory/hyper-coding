import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

import { Flags } from "@oclif/core";

import { AutocompleteBase } from "#base";
import { CompletionResolver } from "#dynamic/resolver";

export default class Generate extends AutocompleteBase {
	static override hidden = true;
	static override description = "Generate dynamic completions (called by shell scripts)";
	static override strict = false;

	static override flags = {
		"enum-values": Flags.string({
			description: "Get enum values for a specific flag (kit:cookbook:recipe:flag)",
		}),
	};

	async run(): Promise<void> {
		const { flags, argv } = await this.parse(Generate);
		const words = argv as string[];

		// Find the project root — look for .hyper directory
		const projectRoot = this.findHyperRoot();
		if (!projectRoot) return; // No hyper project — no dynamic completions

		const resolver = new CompletionResolver(this.autocompleteCacheDir, projectRoot);

		// Handle enum value completion
		if (flags["enum-values"]) {
			const parts = flags["enum-values"].split(":");
			if (parts.length === 4) {
				const values = await resolver.getEnumValues(parts[0], parts[1], parts[2], parts[3]);
				for (const v of values) this.log(v);
			}
			return;
		}

		// Strip CLI routing prefixes before parsing context
		// "gen <kit> <cookbook> ..." → strip "gen"
		// "kit info <kit>" → strip "kit info", complete kit names
		// "kit update <kit>" → strip "kit update", complete kit names
		// "<kit> <cookbook> ..." → no stripping needed (natural syntax)
		const stripped = this.stripRoutingPrefix(words);

		const context = resolver.parseContext(stripped);
		if (!context) return;

		const completions = await resolver.complete(context);
		for (const completion of completions) {
			this.log(completion);
		}
	}

	/**
	 * Strip known CLI command routing prefixes from words so the resolver
	 * sees only content-level tokens (kit/cookbook/recipe/variable).
	 *
	 * Examples:
	 *   ["gen", "nextjs", "crud"] → ["nextjs", "crud"]
	 *   ["kit", "info", "nextjs"] → ["nextjs"]
	 *   ["kit", "install", "next"] → ["next"]
	 *   ["kit", "update", "next"] → ["next"]
	 *   ["nextjs", "crud"] → ["nextjs", "crud"]  (natural syntax, no prefix)
	 */
	private stripRoutingPrefix(words: string[]): string[] {
		if (words.length === 0) return words;

		if (words[0] === "gen") {
			return words.slice(1);
		}

		// "kit <subcommand>" routes — the subcommand is routing, not content
		if (words[0] === "kit" && words.length >= 2) {
			const kitSubcommands = ["info", "install", "update", "list"];
			if (kitSubcommands.includes(words[1])) {
				return words.slice(2);
			}
		}

		return words;
	}

	/**
	 * Walk up from cwd to find a directory containing a `.hyper/` folder.
	 * Returns the directory path, or null if none found.
	 */
	private findHyperRoot(): string | null {
		let dir = process.cwd();
		const { root } = parse(dir);

		while (dir !== root) {
			if (existsSync(join(dir, ".hyper"))) {
				return dir;
			}
			dir = dirname(dir);
		}
		return null;
	}
}
