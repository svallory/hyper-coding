import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Fail closed if a CLI regression reaches provisioning; put this directory first on PATH. */
export function blockInstallers(bin: string): void {
	for (const name of ["curl", "mise", "wget", "npm", "ssh"]) {
		writeFileSync(
			join(bin, name),
			`#!/bin/sh\necho "BLOCKED unexpected ${name} invocation in offline setup test" >&2\nexit 99\n`,
			{ mode: 0o755 },
		);
	}
}
