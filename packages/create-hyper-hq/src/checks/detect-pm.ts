import { spawnSync } from "node:child_process";

export type NodePm = "npm" | "bun" | "pnpm" | "yarn";

export function detectCallingPm(): NodePm {
	const userAgent = process.env["npm_config_user_agent"] ?? "";
	if (userAgent.startsWith("bun")) return "bun";
	if (userAgent.startsWith("pnpm")) return "pnpm";
	if (userAgent.startsWith("yarn")) return "yarn";
	return "npm";
}

const NODE_PMS: NodePm[] = ["npm", "bun", "pnpm", "yarn"];

function isOnPath(name: string): boolean {
	const result = spawnSync("which", [name], { encoding: "utf-8", timeout: 3000 });
	return result.status === 0;
}

export function detectAvailableNodePms(): NodePm[] {
	return NODE_PMS.filter(isOnPath);
}
