import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * C-8: the engine is isolated behind the SyncEngine interface, so a different
 * engine can replace it later. Enforced in two parts, like the C-16 remote
 * boundary:
 *
 *  1. Only services/sync/engine.ts and src/index.ts may import the
 *     implementation module. Everything else goes through the interface.
 *  2. Nothing in the command or config layers may NAME the engine in source —
 *     user-facing output may contain it only by coming THROUGH the engine
 *     (e.g. terminateHint), never by a command or the config loader writing it.
 */
const ALLOWED_IMPORTERS = new Set(["src/services/sync/engine.ts", "src/index.ts"]);

describe("sync engine isolation (C-8)", () => {
	const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

	it("only engine.ts and index.ts import the implementation module", () => {
		const grep = spawnSync("grep", ["-rln", "services/sync/mutagen", "src"], {
			cwd: pkgDir,
			encoding: "utf-8",
		});
		// grep exits 1 with no matches — that would mean the rule guards nothing.
		expect(grep.status).toBe(0);
		const importers = (grep.stdout ?? "").split("\n").filter((line) => line.trim() !== "");
		for (const file of importers) {
			expect(ALLOWED_IMPORTERS.has(file), `${file} imports the engine implementation`).toBe(true);
		}
	});

	it("no 'mutagen' string in commands/ or config/ sources", () => {
		const grep = spawnSync("grep", ["-rin", "mutagen", "src/commands", "src/config"], {
			cwd: pkgDir,
			encoding: "utf-8",
		});
		const lines = (grep.stdout ?? "").split("\n").filter((line) => line.trim() !== "");
		expect(lines).toEqual([]);
	});
});
