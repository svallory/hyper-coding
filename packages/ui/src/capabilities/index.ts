/**
 * Terminal Capability Detection
 *
 * Synchronously detects terminal capabilities by inspecting environment
 * variables and process state. Returns a frozen, immutable object describing
 * what the terminal supports.
 */

/**
 * Describes the color depth supported by the terminal.
 *
 * - `'none'` - No color support (e.g., piped output, `NO_COLOR` set, dumb terminal).
 * - `'16'` - Basic 16-color ANSI support (standard TTY default).
 * - `'256'` - 256-color extended palette (xterm-256color and similar).
 * - `'truecolor'` - 24-bit RGB color support (16.7 million colors).
 */
export type ColorDepth = "none" | "16" | "256" | "truecolor";

/**
 * An immutable snapshot of the terminal's detected capabilities.
 *
 * All properties are `readonly` and the object is frozen at creation time,
 * ensuring capability information cannot be accidentally mutated.
 */
export type TerminalCapabilities = {
	/** The detected color depth the terminal supports. */
	readonly colorDepth: ColorDepth;
	/** Whether the terminal supports Unicode characters (determined from locale settings). */
	readonly unicode: boolean;
	/** Whether `process.stdout` is connected to an interactive TTY. */
	readonly isTTY: boolean;
	/** Whether `process.stderr` is connected to an interactive TTY. */
	readonly isStderrTTY: boolean;
	/** Whether the process is running inside a known CI environment. */
	readonly isCI: boolean;
	/** Whether `TERM` is set to `'dumb'`, indicating a minimal terminal. */
	readonly isDumb: boolean;
	/** Whether the `NO_COLOR` environment variable is present (any value, including empty). */
	readonly noColor: boolean;
	/** The forced color depth from `FORCE_COLOR` env var, or `false` if not set. */
	readonly forceColor: ColorDepth | false;
	/** The terminal width in columns, defaulting to 80 if unavailable. */
	readonly columns: number;
};

/**
 * Environment variable names checked to determine whether
 * the process is running inside a CI (Continuous Integration) system.
 */
const CI_ENV_VARS = [
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

/**
 * Maps `FORCE_COLOR` environment variable string values to their
 * corresponding {@link ColorDepth} levels.
 *
 * - `'0'` -> `'none'`
 * - `'1'` -> `'16'`
 * - `'2'` -> `'256'`
 * - `'3'` -> `'truecolor'`
 */
const FORCE_COLOR_MAP: Record<string, ColorDepth> = {
	"0": "none",
	"1": "16",
	"2": "256",
	"3": "truecolor",
};

/**
 * Parses the `FORCE_COLOR` environment variable into a {@link ColorDepth}.
 *
 * @param env - The environment variables record to inspect.
 * @returns The forced {@link ColorDepth}, or `false` if `FORCE_COLOR` is unset or unrecognized.
 */
function parseForceColor(env: Record<string, string | undefined>): ColorDepth | false {
	const val = env.FORCE_COLOR;
	if (val === undefined) return false;
	return FORCE_COLOR_MAP[val] ?? false;
}

/**
 * Determines the terminal's color depth from environment signals.
 *
 * @param env - The environment variables record to inspect.
 * @param isTTY - Whether stdout is a TTY.
 * @param forceColor - A forced color depth override, or `false` if none.
 * @returns The resolved {@link ColorDepth}.
 */
function detectColorDepth(
	env: Record<string, string | undefined>,
	isTTY: boolean,
	forceColor: ColorDepth | false,
): ColorDepth {
	// FORCE_COLOR always wins when set
	if (forceColor !== false) {
		return forceColor;
	}

	// NO_COLOR set (any value including empty) → 'none'
	if ("NO_COLOR" in env) {
		return "none";
	}

	// TERM=dumb → 'none'
	if (env.TERM === "dumb") {
		return "none";
	}

	// Not a TTY → 'none'
	if (!isTTY) {
		return "none";
	}

	// COLORTERM=truecolor or 24bit
	const colorterm = env.COLORTERM?.toLowerCase();
	if (colorterm === "truecolor" || colorterm === "24bit") {
		return "truecolor";
	}

	// TERM_PROGRAM known truecolor terminals
	const termProgram = env.TERM_PROGRAM;
	if (termProgram === "iTerm.app" || termProgram === "WezTerm") {
		return "truecolor";
	}

	// TERM ending in 256color
	const term = env.TERM;
	if (term && /256color$/i.test(term)) {
		return "256";
	}

	// Default TTY
	return "16";
}

/**
 * Detects Unicode support by inspecting locale environment variables.
 *
 * @param env - The environment variables record to inspect.
 * @returns `true` if UTF-8 is detected in locale settings or the platform is macOS.
 */
function detectUnicode(env: Record<string, string | undefined>): boolean {
	// Check locale env vars for UTF-8
	const localeVars = [env.LC_ALL, env.LC_CTYPE, env.LANG];
	for (const val of localeVars) {
		if (val && /utf-?8/i.test(val)) {
			return true;
		}
	}

	// TERM=dumb or TERM=linux → false
	const term = env.TERM;
	if (term === "dumb" || term === "linux") {
		return false;
	}

	// Default true on macOS
	if (process.platform === "darwin") {
		return true;
	}

	return false;
}

/**
 * Checks whether any known CI environment variable is present.
 *
 * @param env - The environment variables record to inspect.
 * @returns `true` if a CI environment is detected.
 */
function detectCI(env: Record<string, string | undefined>): boolean {
	return CI_ENV_VARS.some((key) => key in env);
}

/**
 * Synchronously detects terminal capabilities from environment variables
 * and process state.
 *
 * Inspects `process.env`, `process.stdout`, and `process.stderr` to build
 * a complete picture of what the current terminal supports.
 *
 * @returns A frozen, immutable {@link TerminalCapabilities} object.
 */
export function detectCapabilities(): TerminalCapabilities {
	const env = process.env;
	const isTTY = !!process.stdout.isTTY;
	const isStderrTTY = !!process.stderr.isTTY;
	const forceColor = parseForceColor(env);
	const noColor = "NO_COLOR" in env;
	const isDumb = env.TERM === "dumb";
	const colorDepth = detectColorDepth(env, isTTY, forceColor);
	const unicode = detectUnicode(env);
	const isCI = detectCI(env);
	const columns = process.stdout.columns || 80;

	return Object.freeze({
		colorDepth,
		unicode,
		isTTY,
		isStderrTTY,
		isCI,
		isDumb,
		noColor,
		forceColor,
		columns,
	});
}

const DEFAULT_CAPABILITIES: TerminalCapabilities = Object.freeze<TerminalCapabilities>({
	colorDepth: "16",
	unicode: true,
	isTTY: true,
	isStderrTTY: true,
	isCI: false,
	isDumb: false,
	noColor: false,
	forceColor: false,
	columns: 80,
});

/**
 * Creates a {@link TerminalCapabilities} object with explicit overrides
 * merged over sensible defaults. Useful for testing or constructing
 * capabilities without inspecting the real environment.
 *
 * @param overrides - Partial capability values to override the defaults.
 * @returns A frozen, immutable {@link TerminalCapabilities} object.
 */
export function createCapabilities(
	overrides?: Partial<TerminalCapabilities>,
): TerminalCapabilities {
	return Object.freeze({ ...DEFAULT_CAPABILITIES, ...overrides });
}
