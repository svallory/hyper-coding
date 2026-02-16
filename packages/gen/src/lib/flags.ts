/**
 * Common flag definitions for gen commands
 */

import { Flags } from "@oclif/core";

export const outputFlags = {
	json: Flags.boolean({
		description: "Output as JSON",
		default: false,
	}),
	verbose: Flags.boolean({
		char: "v",
		description: "Verbose output",
		default: false,
	}),
	quiet: Flags.boolean({
		char: "q",
		description: "Quiet output",
		default: false,
	}),
};

export const executionFlags = {
	...outputFlags,
	dry: Flags.boolean({
		description: "Dry run mode",
		default: false,
	}),
	force: Flags.boolean({
		char: "f",
		description: "Force overwrite",
		default: false,
	}),
	answers: Flags.file({
		description: "Path to AI answers JSON file",
	}),
	dryRun: Flags.boolean({
		description: "Dry run mode (alias for --dry)",
		default: false,
	}),
	skipPrompts: Flags.boolean({
		description: "Skip all prompts",
		default: false,
	}),
	defaults: Flags.boolean({
		description: "Use default values",
		default: false,
	}),
	continueOnError: Flags.boolean({
		description: "Continue on errors",
		default: false,
	}),
	"ai-mode": Flags.string({
		description: "AI mode",
		options: ["me", "ai", "nobody"],
	}),
};

export const validationFlags = {
	...outputFlags,
	strict: Flags.boolean({
		description: "Strict validation mode",
		default: false,
	}),
};

export const flags = outputFlags;
