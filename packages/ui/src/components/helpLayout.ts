/**
 * helpLayout Component
 *
 * Renders a full CLI help screen with usage, description, commands,
 * flag groups, examples, and footer.
 */

import { getContext, indent, stack, styledText, wrap } from "../primitives/index.ts";
import { ansiPad, stringWidth } from "../render/index.ts";

/** Options for rendering a CLI help screen. */
export type HelpLayoutOptions = {
	/** Usage synopsis line (e.g. `'my-cli <command> [options]'`). */
	usage: string;
	/** Short description paragraph shown below usage. */
	description?: string;
	/** Available commands with optional aliases. */
	commands?: Array<{
		/** Command name. */
		name: string;
		/** Brief description of the command. */
		description: string;
		/** Short alias (e.g. `'i'` for `install`). */
		alias?: string;
	}>;
	/** Groups of flags/options. */
	flagGroups?: Array<{
		/** Section title (e.g. `'Global Options'`). */
		title: string;
		/** Flags within this group. */
		flags: Array<{
			/** Short flag character (e.g. `'v'`). */
			short?: string;
			/** Long flag name (e.g. `'verbose'`). */
			long: string;
			/** Brief description of the flag. */
			description: string;
			/** Value type hint shown in brackets (e.g. `'string'`). */
			type?: string;
			/** Default value shown in brackets. */
			default?: string;
			/** Whether this flag is required. */
			required?: boolean;
		}>;
	}>;
	/** Example commands with descriptions. */
	examples?: Array<{
		/** The example command string. */
		command: string;
		/** Explanation of what the example does. */
		description: string;
	}>;
	/** Footer text shown at the bottom in dim style. */
	footer?: string;
};

/**
 * Renders a full CLI help screen with usage, description, commands, flags, examples, and footer.
 *
 * @param options - Help layout configuration.
 * @returns The formatted help screen as a multi-line string.
 */
export function helpLayout(options: HelpLayoutOptions): string {
	const ctx = getContext();
	const gutter = ctx.tokens.space.gutter;
	const sections: string[] = [];

	// Usage line
	sections.push(`Usage: ${styledText(options.usage, { bold: true })}`);

	// Description
	if (options.description) {
		sections.push("");
		sections.push(wrap(options.description));
	}

	// Commands section
	if (options.commands && options.commands.length > 0) {
		sections.push("");
		sections.push(styledText("Commands:", { bold: true }));

		// Calculate max name width
		let maxNameWidth = 0;
		const nameStrs: string[] = [];
		for (const cmd of options.commands) {
			const nameStr = cmd.alias ? `${cmd.name}, ${cmd.alias}` : cmd.name;
			nameStrs.push(nameStr);
			const w = stringWidth(nameStr);
			if (w > maxNameWidth) maxNameWidth = w;
		}

		for (let i = 0; i < options.commands.length; i++) {
			const cmd = options.commands[i]!;
			const name = nameStrs[i]!;
			const padded = ansiPad(name, maxNameWidth);
			sections.push(indent(padded + " ".repeat(gutter) + cmd.description, 1));
		}
	}

	// Flag groups
	if (options.flagGroups) {
		for (const group of options.flagGroups) {
			sections.push("");
			sections.push(styledText(`${group.title}:`, { bold: true }));

			// Build flag name strings and find max width
			let maxFlagWidth = 0;
			const flagStrs: string[] = [];
			for (const flag of group.flags) {
				let flagStr = "";
				if (flag.short) {
					flagStr = `-${flag.short}, --${flag.long}`;
				} else {
					flagStr = `    --${flag.long}`;
				}
				flagStrs.push(flagStr);
				const w = stringWidth(flagStr);
				if (w > maxFlagWidth) maxFlagWidth = w;
			}

			for (let i = 0; i < group.flags.length; i++) {
				const flag = group.flags[i]!;
				const flagStr = flagStrs[i]!;
				const padded = ansiPad(flagStr, maxFlagWidth);

				let desc = flag.description;
				const meta: string[] = [];
				if (flag.type) meta.push(flag.type);
				if (flag.default !== undefined) meta.push(`default: ${flag.default}`);
				if (flag.required) meta.push("required");

				if (meta.length > 0) {
					desc += ` ${styledText(`[${meta.join(", ")}]`, { dim: true })}`;
				}

				sections.push(indent(padded + " ".repeat(gutter) + desc, 1));
			}
		}
	}

	// Examples
	if (options.examples && options.examples.length > 0) {
		sections.push("");
		sections.push(styledText("Examples:", { bold: true }));

		for (const example of options.examples) {
			sections.push(indent(styledText(example.command, { color: "code" }), 1));
			sections.push(indent(styledText(example.description, { dim: true }), 2));
		}
	}

	// Footer
	if (options.footer) {
		sections.push("");
		sections.push(styledText(options.footer, { dim: true }));
	}

	return sections.join("\n");
}
