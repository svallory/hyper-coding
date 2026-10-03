import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * C-16: every ssh/rsync/scp spawn goes through services/remote.ts. Enforced by
 * a test so a new command can't quietly shell out to another machine.
 *
 * The pattern catches `"ssh"`, `'ssh'`, `` `ssh` `` and absolute paths like
 * `/usr/bin/ssh`, so none of those spellings is an escape hatch.
 */
const REMOTE_BINARIES = "['\"`](/usr/bin/)?(ssh|rsync|scp)['\"`]";

describe("remote execution boundary (C-16)", () => {
	const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

	it('only services/remote.ts mentions "ssh", "rsync" or "scp"', () => {
		const grep = spawnSync("grep", ["-rnE", REMOTE_BINARIES, "src"], {
			cwd: pkgDir,
			encoding: "utf-8",
		});

		// grep exits 1 when there are no matches at all — that would mean the
		// rule stopped guarding anything, so treat it as a failure too.
		expect(grep.status).toBe(0);

		const offenders = grep.stdout
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => line.split(":")[0])
			.filter((file) => file !== "src/services/remote.ts");

		expect(offenders).toEqual([]);
	});
});
