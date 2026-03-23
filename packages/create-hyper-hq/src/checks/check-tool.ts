import { spawnSync } from "node:child_process";

function getLoginShell(): string {
	return process.env["SHELL"] ?? "/bin/bash";
}

export function isToolInstalled(name: string): boolean {
	const shell = getLoginShell();
	const result = spawnSync(shell, ["-l", "-c", `which ${name}`], {
		encoding: "utf-8",
		timeout: 5000,
	});
	return result.status === 0;
}

export function getToolVersion(name: string): string | null {
	const shell = getLoginShell();
	const result = spawnSync(shell, ["-l", "-c", `${name} --version`], {
		encoding: "utf-8",
		timeout: 5000,
	});
	if (result.status !== 0) return null;
	return result.stdout.trim() || null;
}
