import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface PlatformInfo {
	os: "macos" | "linux" | "windows";
	distroId: string | null;
	isRoot: boolean;
}

function getLinuxDistroId(): string | null {
	try {
		const osRelease = readFileSync("/etc/os-release", "utf-8");
		const match = osRelease.match(/^ID=(.+)$/m);
		return match?.[1]?.replace(/"/g, "") ?? null;
	} catch {
		return null;
	}
}

export function detectPlatform(): PlatformInfo {
	const platform = process.platform;
	const isRoot = process.getuid?.() === 0;

	if (platform === "darwin") {
		return { os: "macos", distroId: null, isRoot };
	}

	if (platform === "linux") {
		return { os: "linux", distroId: getLinuxDistroId(), isRoot };
	}

	return { os: "windows", distroId: null, isRoot };
}

const SYSTEM_PMS = ["brew", "apt", "dnf", "pacman", "apk", "zypper", "port", "conda"];

function isOnPath(name: string): boolean {
	const result = spawnSync("which", [name], { encoding: "utf-8", timeout: 3000 });
	return result.status === 0;
}

export function detectSystemPms(): string[] {
	return SYSTEM_PMS.filter(isOnPath);
}
