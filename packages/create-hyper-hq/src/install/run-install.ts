import { spawnSync } from "node:child_process";
import type { InstallOption } from "./install-options.js";

export interface InstallResult {
	success: boolean;
	error?: string;
}

export function runInstallCommand(option: InstallOption): InstallResult {
	if (!option.command || !option.args) {
		return { success: false, error: "No command specified for this install option." };
	}

	try {
		const result = spawnSync(option.command, option.args, {
			stdio: "pipe",
			encoding: "utf-8",
		});

		if (result.error) {
			return { success: false, error: result.error.message };
		}

		if (result.status !== 0) {
			const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
			return {
				success: false,
				error: stderr || `Command exited with code ${result.status}`,
			};
		}

		return { success: true };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
