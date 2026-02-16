import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CLIOptions {
	cwd?: string;
	env?: Record<string, string>;
	reject?: boolean;
}

export interface CLIResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	failed: boolean;
}

/**
 * Run the CLI with given arguments
 */
export async function runCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
	const cliPath = path.join(__dirname, "../../bin/run.js");
	const result = await execa("bun", [cliPath, ...args], {
		cwd: options.cwd || process.cwd(),
		env: { ...process.env, NODE_ENV: "test", ...options.env },
		reject: options.reject ?? false,
	});

	return {
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
		failed: result.failed,
	};
}

/**
 * Run the dev CLI with given arguments
 */
export async function runDevCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
	const cliPath = path.join(__dirname, "../../bin/dev.js");
	const result = await execa("bun", [cliPath, ...args], {
		cwd: options.cwd || process.cwd(),
		env: { ...process.env, NODE_ENV: "test", ...options.env },
		reject: options.reject ?? false,
	});

	return {
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
		failed: result.failed,
	};
}

/**
 * Check if CLI output contains a command
 */
export function hasCommand(output: string, command: string): boolean {
	// Match command patterns like "  run <recipe>" or "  kit install"
	const commandPattern = new RegExp(
		`^\\s+${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
		"m",
	);
	return commandPattern.test(output);
}

/**
 * Check if CLI output contains a topic
 */
export function hasTopic(output: string, topic: string): boolean {
	// Match topic patterns in help output
	const topicPattern = new RegExp(`^\\s*${topic}\\s`, "m");
	return topicPattern.test(output);
}

/**
 * Parse help output to extract available commands
 */
export function parseCommands(output: string): string[] {
	const commands: string[] = [];
	const lines = output.split("\n");
	let inCommandsSection = false;

	for (const line of lines) {
		// Detect commands section start (COMMANDS or COMMANDS:)
		if (line.toLowerCase().includes("commands")) {
			inCommandsSection = true;
			continue;
		}

		// Detect section end - new section header (ALL CAPS word like TOPICS)
		if (inCommandsSection && /^[A-Z][A-Z\s]*$/.test(line.trim())) {
			inCommandsSection = false;
			continue;
		}

		// Skip empty lines within commands section
		if (inCommandsSection && line.trim() === "") {
			continue;
		}

		// Extract command from indented lines in commands section
		if (inCommandsSection) {
			// Match lines that start with whitespace followed by a command name
			const match = line.match(/^\s+(\S+)/);
			if (match) {
				commands.push(match[1]);
			}
		}
	}

	return commands;
}
