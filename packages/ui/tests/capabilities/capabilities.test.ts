import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	type ColorDepth,
	type TerminalCapabilities,
	createCapabilities,
	detectCapabilities,
} from "../../src/capabilities/index.ts";

// ---------------------------------------------------------------------------
// Helpers to save/restore process state
// ---------------------------------------------------------------------------

let savedEnv: Record<string, string | undefined>;
let savedStdoutIsTTY: boolean | undefined;
let savedStderrIsTTY: boolean | undefined;
let savedStdoutColumns: number | undefined;
let savedPlatform: string;

function saveState() {
	savedEnv = { ...process.env };
	savedStdoutIsTTY = process.stdout.isTTY;
	savedStderrIsTTY = process.stderr.isTTY;
	savedStdoutColumns = process.stdout.columns;
	savedPlatform = process.platform;
}

function restoreState() {
	// Restore env: delete keys that weren't there, restore original values
	for (const key of Object.keys(process.env)) {
		if (!(key in savedEnv)) {
			delete process.env[key];
		}
	}
	for (const [key, val] of Object.entries(savedEnv)) {
		if (val === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = val;
		}
	}

	Object.defineProperty(process.stdout, "isTTY", {
		value: savedStdoutIsTTY,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(process.stderr, "isTTY", {
		value: savedStderrIsTTY,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(process.stdout, "columns", {
		value: savedStdoutColumns,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(process, "platform", {
		value: savedPlatform,
		configurable: true,
		writable: true,
	});
}

function setTTY(stdout: boolean, stderr?: boolean) {
	Object.defineProperty(process.stdout, "isTTY", {
		value: stdout ? true : undefined,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(process.stderr, "isTTY", {
		value: (stderr ?? stdout) ? true : undefined,
		configurable: true,
		writable: true,
	});
}

function setPlatform(platform: string) {
	Object.defineProperty(process, "platform", {
		value: platform,
		configurable: true,
		writable: true,
	});
}

function setColumns(cols: number | undefined) {
	Object.defineProperty(process.stdout, "columns", {
		value: cols,
		configurable: true,
		writable: true,
	});
}

/** Clear all env vars that affect detection so tests start clean. */
function clearDetectionEnv() {
	const keys = [
		"FORCE_COLOR",
		"NO_COLOR",
		"TERM",
		"COLORTERM",
		"TERM_PROGRAM",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"CI",
		"GITHUB_ACTIONS",
		"GITLAB_CI",
		"CIRCLECI",
		"TRAVIS",
		"BUILDKITE",
		"DRONE",
		"TF_BUILD",
		"JENKINS_URL",
		"CODEBUILD_BUILD_ID",
	];
	for (const k of keys) {
		delete process.env[k];
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectCapabilities", () => {
	beforeEach(() => {
		saveState();
		clearDetectionEnv();
	});

	afterEach(() => {
		restoreState();
	});

	// ---- Basic TTY detection ------------------------------------------------

	describe("TTY detection", () => {
		test("isTTY reflects stdout", () => {
			setTTY(true);
			expect(detectCapabilities().isTTY).toBe(true);

			setTTY(false);
			expect(detectCapabilities().isTTY).toBe(false);
		});

		test("isStderrTTY reflects stderr independently", () => {
			setTTY(true, false);
			const caps = detectCapabilities();
			expect(caps.isTTY).toBe(true);
			expect(caps.isStderrTTY).toBe(false);
		});

		test("non-TTY defaults colorDepth to none", () => {
			setTTY(false);
			expect(detectCapabilities().colorDepth).toBe("none");
		});
	});

	// ---- Color depth detection ----------------------------------------------

	describe("color depth detection", () => {
		test("default TTY gets 16 colors", () => {
			setTTY(true);
			expect(detectCapabilities().colorDepth).toBe("16");
		});

		test("COLORTERM=truecolor → truecolor", () => {
			setTTY(true);
			process.env.COLORTERM = "truecolor";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("COLORTERM=24bit → truecolor", () => {
			setTTY(true);
			process.env.COLORTERM = "24bit";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("TERM_PROGRAM=iTerm.app → truecolor", () => {
			setTTY(true);
			process.env.TERM_PROGRAM = "iTerm.app";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("TERM_PROGRAM=WezTerm → truecolor", () => {
			setTTY(true);
			process.env.TERM_PROGRAM = "WezTerm";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("TERM=xterm-256color → 256", () => {
			setTTY(true);
			process.env.TERM = "xterm-256color";
			expect(detectCapabilities().colorDepth).toBe("256");
		});

		test("TERM=screen-256color → 256", () => {
			setTTY(true);
			process.env.TERM = "screen-256color";
			expect(detectCapabilities().colorDepth).toBe("256");
		});

		test("TERM=dumb → none, isDumb true", () => {
			setTTY(true);
			process.env.TERM = "dumb";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("none");
			expect(caps.isDumb).toBe(true);
		});
	});

	// ---- NO_COLOR -----------------------------------------------------------

	describe("NO_COLOR", () => {
		test("NO_COLOR set → colorDepth none, noColor true", () => {
			setTTY(true);
			process.env.NO_COLOR = "1";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("none");
			expect(caps.noColor).toBe(true);
		});

		test("NO_COLOR empty string → still triggers", () => {
			setTTY(true);
			process.env.NO_COLOR = "";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("none");
			expect(caps.noColor).toBe(true);
		});

		test("NO_COLOR not set → noColor false", () => {
			setTTY(true);
			process.env.NO_COLOR = undefined;
			expect(detectCapabilities().noColor).toBe(false);
		});
	});

	// ---- FORCE_COLOR --------------------------------------------------------

	describe("FORCE_COLOR", () => {
		test("FORCE_COLOR=0 → colorDepth none", () => {
			setTTY(true);
			process.env.FORCE_COLOR = "0";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("none");
			expect(caps.forceColor).toBe("none");
		});

		test("FORCE_COLOR=1 → 16", () => {
			setTTY(true);
			process.env.FORCE_COLOR = "1";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("16");
			expect(caps.forceColor).toBe("16");
		});

		test("FORCE_COLOR=2 → 256", () => {
			setTTY(true);
			process.env.FORCE_COLOR = "2";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("256");
			expect(caps.forceColor).toBe("256");
		});

		test("FORCE_COLOR=3 → truecolor", () => {
			setTTY(true);
			process.env.FORCE_COLOR = "3";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("truecolor");
			expect(caps.forceColor).toBe("truecolor");
		});

		test("FORCE_COLOR overrides non-TTY", () => {
			setTTY(false);
			process.env.FORCE_COLOR = "3";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("FORCE_COLOR overrides TERM=dumb", () => {
			setTTY(true);
			process.env.TERM = "dumb";
			process.env.FORCE_COLOR = "2";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("256");
			expect(caps.isDumb).toBe(true); // isDumb still reflects TERM
		});

		test("FORCE_COLOR wins over NO_COLOR when both set", () => {
			setTTY(true);
			process.env.NO_COLOR = "";
			process.env.FORCE_COLOR = "3";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("truecolor");
			expect(caps.noColor).toBe(true); // noColor flag still set
			expect(caps.forceColor).toBe("truecolor");
		});

		test("FORCE_COLOR=0 with NO_COLOR → both flags set, colorDepth none", () => {
			setTTY(true);
			process.env.NO_COLOR = "";
			process.env.FORCE_COLOR = "0";
			const caps = detectCapabilities();
			expect(caps.colorDepth).toBe("none");
			expect(caps.noColor).toBe(true);
			expect(caps.forceColor).toBe("none");
		});

		test("unknown FORCE_COLOR value → treated as not set", () => {
			setTTY(true);
			process.env.FORCE_COLOR = "banana";
			const caps = detectCapabilities();
			expect(caps.forceColor).toBe(false);
			expect(caps.colorDepth).toBe("16"); // falls through to default TTY
		});

		test("FORCE_COLOR not set → forceColor is false", () => {
			setTTY(true);
			process.env.FORCE_COLOR = undefined;
			expect(detectCapabilities().forceColor).toBe(false);
		});
	});

	// ---- Unicode detection --------------------------------------------------

	describe("unicode detection", () => {
		test("LANG=en_US.UTF-8 → unicode true", () => {
			setTTY(true);
			setPlatform("linux");
			process.env.LANG = "en_US.UTF-8";
			expect(detectCapabilities().unicode).toBe(true);
		});

		test("LC_ALL=C.UTF-8 → unicode true", () => {
			setTTY(true);
			setPlatform("linux");
			process.env.LC_ALL = "C.UTF-8";
			expect(detectCapabilities().unicode).toBe(true);
		});

		test("LC_CTYPE=en_US.utf8 (no hyphen) → unicode true", () => {
			setTTY(true);
			setPlatform("linux");
			process.env.LC_CTYPE = "en_US.utf8";
			expect(detectCapabilities().unicode).toBe(true);
		});

		test("macOS defaults to unicode true", () => {
			setTTY(true);
			setPlatform("darwin");
			expect(detectCapabilities().unicode).toBe(true);
		});

		test("linux without UTF-8 locale → unicode false", () => {
			setTTY(true);
			setPlatform("linux");
			process.env.LANG = "C";
			expect(detectCapabilities().unicode).toBe(false);
		});

		test("TERM=dumb → unicode false", () => {
			setTTY(true);
			setPlatform("darwin");
			process.env.TERM = "dumb";
			expect(detectCapabilities().unicode).toBe(false);
		});

		test("TERM=linux → unicode false", () => {
			setTTY(true);
			setPlatform("darwin");
			process.env.TERM = "linux";
			expect(detectCapabilities().unicode).toBe(false);
		});

		test("LC_ALL takes precedence over LANG", () => {
			setTTY(true);
			setPlatform("linux");
			process.env.LANG = "C";
			process.env.LC_ALL = "en_US.UTF-8";
			expect(detectCapabilities().unicode).toBe(true);
		});
	});

	// ---- CI detection -------------------------------------------------------

	describe("CI detection", () => {
		const ciVars = [
			"CI",
			"GITHUB_ACTIONS",
			"GITLAB_CI",
			"CIRCLECI",
			"TRAVIS",
			"BUILDKITE",
			"DRONE",
			"TF_BUILD",
			"JENKINS_URL",
			"CODEBUILD_BUILD_ID",
		] as const;

		for (const envVar of ciVars) {
			test(`${envVar} → isCI true`, () => {
				setTTY(true);
				process.env[envVar] = "true";
				expect(detectCapabilities().isCI).toBe(true);
			});
		}

		test("no CI vars → isCI false", () => {
			setTTY(true);
			expect(detectCapabilities().isCI).toBe(false);
		});
	});

	// ---- Terminal width -----------------------------------------------------

	describe("terminal width", () => {
		test("uses process.stdout.columns when available", () => {
			setTTY(true);
			setColumns(120);
			expect(detectCapabilities().columns).toBe(120);
		});

		test("defaults to 80 when columns not available", () => {
			setTTY(true);
			setColumns(undefined);
			expect(detectCapabilities().columns).toBe(80);
		});

		test("defaults to 80 when columns is 0", () => {
			setTTY(true);
			setColumns(0);
			expect(detectCapabilities().columns).toBe(80);
		});
	});

	// ---- Immutability -------------------------------------------------------

	describe("immutability", () => {
		test("returned object is frozen", () => {
			setTTY(true);
			const caps = detectCapabilities();
			expect(Object.isFrozen(caps)).toBe(true);
		});

		test("cannot modify properties", () => {
			setTTY(true);
			const caps = detectCapabilities();
			expect(() => {
				(caps as any).colorDepth = "truecolor";
			}).toThrow();
		});
	});

	// ---- Priority / edge case combos ---------------------------------------

	describe("priority and edge cases", () => {
		test("COLORTERM=truecolor beats TERM=xterm-256color", () => {
			setTTY(true);
			process.env.TERM = "xterm-256color";
			process.env.COLORTERM = "truecolor";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("TERM_PROGRAM=iTerm.app beats TERM=xterm-256color", () => {
			setTTY(true);
			process.env.TERM = "xterm-256color";
			process.env.TERM_PROGRAM = "iTerm.app";
			expect(detectCapabilities().colorDepth).toBe("truecolor");
		});

		test("FORCE_COLOR overrides everything including COLORTERM", () => {
			setTTY(true);
			process.env.COLORTERM = "truecolor";
			process.env.FORCE_COLOR = "1";
			expect(detectCapabilities().colorDepth).toBe("16");
		});

		test("non-TTY with no FORCE_COLOR → none despite COLORTERM", () => {
			setTTY(false);
			process.env.COLORTERM = "truecolor";
			expect(detectCapabilities().colorDepth).toBe("none");
		});
	});
});

// ---------------------------------------------------------------------------
// createCapabilities
// ---------------------------------------------------------------------------

describe("createCapabilities", () => {
	test("returns sensible defaults with no overrides", () => {
		const caps = createCapabilities();
		expect(caps.colorDepth).toBe("16");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.isStderrTTY).toBe(true);
		expect(caps.isCI).toBe(false);
		expect(caps.isDumb).toBe(false);
		expect(caps.noColor).toBe(false);
		expect(caps.forceColor).toBe(false);
		expect(caps.columns).toBe(80);
	});

	test("overrides merge correctly", () => {
		const caps = createCapabilities({
			colorDepth: "truecolor",
			columns: 200,
			isCI: true,
		});
		expect(caps.colorDepth).toBe("truecolor");
		expect(caps.columns).toBe(200);
		expect(caps.isCI).toBe(true);
		// defaults preserved
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
	});

	test("returned object is frozen", () => {
		const caps = createCapabilities();
		expect(Object.isFrozen(caps)).toBe(true);
	});

	test("can override all fields", () => {
		const full: TerminalCapabilities = {
			colorDepth: "none",
			unicode: false,
			isTTY: false,
			isStderrTTY: false,
			isCI: true,
			isDumb: true,
			noColor: true,
			forceColor: "truecolor",
			columns: 40,
		};
		const caps = createCapabilities(full);
		expect(caps).toEqual(full);
	});
});
