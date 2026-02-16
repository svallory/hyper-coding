/**
 * Command Not Found Hook
 *
 * When oclif can't find a command, check if the first argument could be
 * a kit/cookbook/recipe path. If so, re-dispatch as `run <original args...>`.
 *
 * This enables the natural syntax:
 *   hypergen nextjs crud update Organization
 * instead of requiring:
 *   hypergen run nextjs crud update Organization
 *
 * If the recipe also isn't found, provide helpful suggestions using
 * Levenshtein distance.
 */

import {
	discoverKits,
	error as formatError,
	tip as formatTip,
	getKitsDirectory,
	styleCommand,
} from "@hypercli/core";
import type { Hook } from "@oclif/core";
import { getSuggestions } from "./suggest.js";

/**
 * Flags that the Run command declares and oclif should parse normally.
 * Everything else is a recipe parameter and must go after `--`.
 */
const KNOWN_RUN_FLAGS = new Set([
	"dry",
	"force",
	"yes",
	"answers",
	"prompt-template",
	"ask",
	"no-defaults",
	"cwd",
	"debug",
	"config",
	// Short aliases
	"f",
	"y",
	"d",
]);

const hook: Hook.CommandNotFound = async (opts) => {
	const commandId = opts.id;

	// Don't intercept empty commands, flags, or built-in oclif commands
	const BUILTIN_COMMANDS = new Set(["help", "version", "plugins", "which", "commands"]);
	if (!commandId || commandId.startsWith("-") || BUILTIN_COMMANDS.has(commandId.split(":")[0])) {
		return;
	}

	// oclif joins command hierarchies with colons (e.g., "nextjs:project:create")
	// Split them into separate segments for our path resolver
	const segments = commandId.split(":");

	// Separate known Run flags from recipe-specific params.
	// oclif rejects unknown --flags even with strict:false, so we put
	// recipe params after a `--` separator to pass them through as raw argv.
	const knownArgs: string[] = [];
	const recipeArgs: string[] = [];
	let seenSeparator = false;

	for (const arg of opts.argv ?? []) {
		if (arg === "--") {
			seenSeparator = true;
			continue;
		}

		if (seenSeparator) {
			recipeArgs.push(arg);
			continue;
		}

		if (arg.startsWith("--")) {
			const flagName = arg.slice(2).split("=")[0];
			if (KNOWN_RUN_FLAGS.has(flagName)) {
				knownArgs.push(arg);
			} else {
				recipeArgs.push(arg);
			}
		} else if (arg.startsWith("-") && arg.length === 2) {
			// Short flag like -f, -y, -d
			const shortFlag = arg.slice(1);
			if (KNOWN_RUN_FLAGS.has(shortFlag)) {
				knownArgs.push(arg);
			} else {
				recipeArgs.push(arg);
			}
		} else {
			// Positional arg — keep before `--`
			knownArgs.push(arg);
		}
	}

	// Build final argv: segments + known flags + -- + recipe params
	const argv = [...segments, ...knownArgs];
	if (recipeArgs.length > 0) {
		argv.push("--", ...recipeArgs);
	}

	// Try to run as a recipe via the gen command
	try {
		await opts.config.runCommand("gen", argv);
	} catch (error: any) {
		// If it's an exit code, propagate it
		if (error?.code === "EEXIT") {
			throw error;
		}

		// If recipe wasn't found, show helpful error with suggestions
		if (
			error?.message?.includes("not found") ||
			error?.message?.includes("No recipe") ||
			error?.code === "ENOENT"
		) {
			await showCommandNotFoundError(commandId, opts);
			// Exit with error code
			process.exit(1);
		}

		// For other errors, propagate them
		throw error;
	}
};

/**
 * Show helpful error message with suggestions when command isn't found
 */
async function showCommandNotFoundError(
	commandId: string,
	opts: Parameters<Hook.CommandNotFound>[0],
): Promise<void> {
	// Get all available commands
	const allCommandIds = opts.config.getAllCommandIDs();

	// Get installed kits
	let installedKits: string[] = [];
	try {
		const kitsDir = getKitsDirectory();
		const kits = await discoverKits([kitsDir]);
		installedKits = Array.from(kits.values()).map((kit) => kit.config.name);
	} catch {
		// If discovery fails, continue without kit names
	}

	// Combine candidates: command IDs + kit names
	const candidates = [...allCommandIds, ...installedKits];

	// Get suggestions using Levenshtein distance
	const suggestions = getSuggestions(commandId, candidates);

	// Build friendly error message
	let errorMessage = `Uh oh! I couldn't find any command or hyper kit named ${styleCommand(commandId)}.`;
	if (suggestions.length > 0) {
		errorMessage += ` Did you mean ${styleCommand(suggestions[0])}?`;
	}

	// Build tip body with available commands and kits
	const tipBody: string[] = [];

	if (suggestions.length > 1) {
		tipBody.push("Other suggestions:");
		for (const suggestion of suggestions.slice(1, 4)) {
			tipBody.push(`  ${styleCommand(suggestion)}`);
		}
		tipBody.push("");
	}

	tipBody.push("Available commands:");
	const mainCommands = allCommandIds
		.filter((id) => !id.includes(":"))
		.sort()
		.map(styleCommand);
	tipBody.push(`  ${mainCommands.join(", ")}`);

	if (installedKits.length > 0) {
		tipBody.push("");
		tipBody.push("Installed kits:");
		const styledKits = installedKits.map(styleCommand);
		tipBody.push(`  ${styledKits.join(", ")}`);
	}

	tipBody.push("");
	tipBody.push(`Run ${styleCommand("hyper --help")} for usage.`);

	// Show error followed by tip
	console.error(formatError(errorMessage));
	console.error(formatTip("Here are the available commands and kits", tipBody.join("\n")));
}

export default hook;
