/**
 * Test Mocking Utilities
 *
 * Helpers for creating mock capabilities, themes, and test contexts.
 */

import type { ColorDepth, TerminalCapabilities } from "../capabilities/index.ts";
import { createCapabilities } from "../capabilities/index.ts";
import { createContext, setContext } from "../primitives/index.ts";
import type { SystemContext } from "../primitives/index.ts";
import type { Theme, ThemeInput } from "../theme/index.ts";

/**
 * Predefined terminal capability presets for testing.
 * - `'full'` — truecolor, unicode, TTY, 120 columns
 * - `'ansi256'` — 256-color, unicode, TTY
 * - `'ansi16'` — 16-color, unicode, TTY
 * - `'nocolor'` — color disabled (NO_COLOR), unicode, TTY
 * - `'dumb'` — no color, no unicode, TERM=dumb
 * - `'ascii'` — 16-color, no unicode, TTY
 * - `'ci'` — 16-color, unicode, non-TTY CI environment
 */
export type CapabilityPreset = "full" | "ansi256" | "ansi16" | "nocolor" | "dumb" | "ascii" | "ci";

const PRESETS: Record<CapabilityPreset, Partial<TerminalCapabilities>> = {
	full: {
		colorDepth: "truecolor" as ColorDepth,
		unicode: true,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: false,
		noColor: false,
		forceColor: false,
		columns: 120,
	},
	ansi256: {
		colorDepth: "256" as ColorDepth,
		unicode: true,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: false,
		noColor: false,
		forceColor: false,
		columns: 80,
	},
	ansi16: {
		colorDepth: "16" as ColorDepth,
		unicode: true,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: false,
		noColor: false,
		forceColor: false,
		columns: 80,
	},
	nocolor: {
		colorDepth: "none" as ColorDepth,
		unicode: true,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: false,
		noColor: true,
		forceColor: false,
		columns: 80,
	},
	dumb: {
		colorDepth: "none" as ColorDepth,
		unicode: false,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: true,
		noColor: false,
		forceColor: false,
		columns: 80,
	},
	ascii: {
		colorDepth: "16" as ColorDepth,
		unicode: false,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: false,
		noColor: false,
		forceColor: false,
		columns: 80,
	},
	ci: {
		colorDepth: "16" as ColorDepth,
		unicode: true,
		isTTY: false,
		isStderrTTY: false,
		isCI: true,
		isDumb: false,
		noColor: false,
		forceColor: false,
		columns: 80,
	},
};

/**
 * Creates a mock {@link TerminalCapabilities} object for testing at a specific tier.
 *
 * @param preset - A named capability preset, or omit for bare defaults.
 * @param overrides - Additional overrides merged on top of the preset.
 * @returns A frozen capabilities object.
 */
export function mockCapabilities(
	preset?: CapabilityPreset,
	overrides?: Partial<TerminalCapabilities>,
): TerminalCapabilities {
	const base = preset ? PRESETS[preset] : {};
	return createCapabilities({ ...base, ...overrides });
}

/**
 * Creates a mock theme for testing with sensible defaults.
 *
 * @param overrides - Partial theme properties to set.
 * @returns A theme object with a default name of `'test-theme'`.
 */
export function mockTheme(overrides: Partial<Theme>): Theme {
	return {
		name: overrides.name ?? "test-theme",
		...overrides,
	};
}

/**
 * Sets up a global test context with the given capabilities and theme.
 * Returns a cleanup function that resets the context to defaults.
 *
 * @param preset - Capability preset to use.
 * @param themeInput - Optional theme configuration.
 * @returns A cleanup function that restores the default context.
 *
 * @example
 * ```ts
 * const cleanup = setupTestContext('full')
 * // ... run tests ...
 * cleanup()
 * ```
 */
export function setupTestContext(preset?: CapabilityPreset, themeInput?: ThemeInput): () => void {
	const caps = mockCapabilities(preset);
	const ctx = createContext(caps, themeInput);
	setContext(ctx);

	return () => {
		// Reset to a default context
		const defaultCtx = createContext();
		setContext(defaultCtx);
	};
}
