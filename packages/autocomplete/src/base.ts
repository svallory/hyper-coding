import { mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { Command } from "@oclif/core";

export abstract class AutocompleteBase extends Command {
	get acLogfilePath(): string {
		return path.join(this.config.cacheDir, "autocomplete.log");
	}

	get autocompleteCacheDir(): string {
		return path.join(this.config.cacheDir, "autocomplete");
	}

	get cliBin(): string {
		return this.config.bin;
	}

	get cliBinEnvVar(): string {
		return this.config.bin.toUpperCase().replaceAll("-", "_");
	}

	determineShell(shell: string): string {
		if (!shell) {
			this.error("Missing required argument shell");
		} else if (this.isBashOnWindows(shell)) {
			return "bash";
		} else {
			return shell;
		}
	}

	getSetupEnvVar(shell: string): string {
		return `${this.cliBinEnvVar}_AC_${shell.toUpperCase()}_SETUP_PATH`;
	}

	writeLogFile(msg: string): void {
		mkdirSync(this.config.cacheDir, { recursive: true });
		const entry = `[${new Date().toISOString()}] ${msg}\n`;
		const fd = openSync(this.acLogfilePath, "a");
		writeSync(fd, entry);
	}

	private isBashOnWindows(shell: string): boolean {
		return shell.endsWith("\\bash.exe");
	}
}
