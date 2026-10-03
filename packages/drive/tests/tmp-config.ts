import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Write `toml` to a throwaway file and point HYPER_DRIVE_CONFIG at it, so a test
 * can exercise one malformed shape without a permanent fixture per case.
 */
export function withTempConfig(toml: string): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-config-"));
	const path = join(dir, "drive.toml");
	writeFileSync(path, toml, "utf-8");
	process.env.HYPER_DRIVE_CONFIG = path;
	return path;
}
