/**
 * Shared flag definitions for kit browse commands
 */

import { Flags } from "@oclif/core";

export const outputFlags = {
	json: Flags.boolean({
		description: "Output as JSON",
		default: false,
	}),
};

export const infoFlags = {
	...outputFlags,
	variables: Flags.boolean({
		description: "Show variable details",
		default: false,
	}),
	source: Flags.boolean({
		description: "Show provenance info (path, URL, commit)",
		default: false,
	}),
	steps: Flags.boolean({
		description: "Show step list with tool types (recipe info only)",
		default: false,
	}),
	recipes: Flags.boolean({
		description: "Expand recipes with descriptions",
		default: false,
	}),
};
