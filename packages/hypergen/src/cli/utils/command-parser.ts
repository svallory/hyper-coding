// src/cli/utils/command-parser.ts

/**
 * Parses command-line arguments to extract flags (e.g., --dryRun, --force).
 * Flags are boolean by default if present, or can have values (e.g., --name=value).
 * @param args - Array of command-line arguments.
 * @returns A Set of flag names.
 */
export function parseFlags(args: string[]): Set<string> {
	const flags = new Set<string>();
	for (const arg of args) {
		if (arg.startsWith('--')) {
			flags.add(arg.substring(2).split('=')[0]);
		}
	}
	return flags;
}

/**
 * Parses command-line arguments to extract parameters (non-flag arguments).
 * Parameters are expected to be in the format `key=value`.
 * @param args - Array of command-line arguments.
 * @returns An object where keys are parameter names and values are their parsed values.
 */
export function parseParameters(args: string[]): Record<string, string> {
	const parameters: Record<string, string> = {};
	for (const arg of args) {
		if (!arg.startsWith('--')) {
			const parts = arg.split('=');
			if (parts.length === 2) {
				parameters[parts[0]] = parts[1];
			}
		}
	}
	return parameters;
}
