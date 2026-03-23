import { spawn, spawnSync } from "node:child_process";

export function isClaudeAuthenticated(): boolean {
	const result = spawnSync("claude", ["auth", "status"], {
		encoding: "utf-8",
		timeout: 10000,
	});
	return result.status === 0;
}

export async function runClaudeLogin(): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn("claude", ["auth", "login"], {
			stdio: "inherit",
		});

		child.on("close", (code) => {
			resolve(code === 0);
		});

		child.on("error", () => {
			resolve(false);
		});
	});
}
