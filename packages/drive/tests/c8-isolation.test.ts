import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * C-8: the engine is isolated behind the SyncEngine interface, so a different
 * engine can replace it later. Enforced the same way as the C-16 remote
 * boundary: nothing in the command or config layers may NAME the engine.
 *
 * The word is allowed in `services/sync/mutagen.ts` (the implementation) and
 * in import specifiers that point at it. User-facing output may still contain
 * it — but only because it came THROUGH the engine (e.g. terminateHint), never
 * because a command or the config loader wrote it.
 */
describe("sync engine isolation (C-8)", () => {
	const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

	it("no 'mutagen' in commands/ or config/ sources", () => {
		const grep = spawnSync("grep", ["-rin", "mutagen", "src/commands", "src/config"], {
			cwd: pkgDir,
			encoding: "utf-8",
		});
		// grep exits 1 when there are no matches — that is the passing state.
		const lines = (grep.stdout ?? "")
			.split("\n")
			.filter((line) => line.trim() !== "")
			// Import specifiers that point at the engine module are fine.
			.filter((line) => !line.includes('from "#services/sync/mutagen"'));
		expect(lines).toEqual([]);
	});
});
