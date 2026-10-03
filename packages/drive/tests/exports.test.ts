import { describe, expect, it } from "vitest";
import * as drive from "#index";

/**
 * The package's public surface.
 *
 * This exists because a whole service once went missing from `src/index.ts`
 * while its own tests kept passing: the tests import services through
 * `#services/*`, so nothing noticed that no caller outside the package could
 * reach it. A symbol added to a service and not exported is now a failing
 * test rather than a silent gap.
 */

const ALLOWLIST_EXPORTS = [
	"AllowlistError",
	"findSecretPaths",
	"renderGitignore",
	"SECRET_PATTERNS",
] as const;

const SPACE_GIT_EXPORTS = [
	"hasSpaceGit",
	"initSpaceGitDir",
	"readCadence",
	"SpaceGitError",
	"spaceGit",
	"spaceGitDir",
	"writeCadence",
] as const;

describe("the package index", () => {
	it("exports the allowlist renderer and secret guard", () => {
		for (const name of ALLOWLIST_EXPORTS) {
			expect(drive, `${name} should be exported`).toHaveProperty(name);
		}
	});

	it("exports the space git runner", () => {
		for (const name of SPACE_GIT_EXPORTS) {
			expect(drive, `${name} should be exported`).toHaveProperty(name);
		}
	});

	it("exports the config, space and session services too", () => {
		for (const name of [
			"ConfigError",
			"loadConfig",
			"DEFAULT_CONFIG",
			"detectSpace",
			"findSpaceRoot",
			"listTranscripts",
			"BaseCommand",
		]) {
			expect(drive, `${name} should be exported`).toHaveProperty(name);
		}
	});
});
