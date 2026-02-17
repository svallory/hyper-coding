/**
 * System Context
 *
 * Provides a shared context object that holds the ThemeEngine and resolved
 * tokens. Primitives read from this context instead of accepting tokens
 * as parameters on every call.
 */

import { createCapabilities, detectCapabilities } from "../capabilities/index.ts";
import type { TerminalCapabilities } from "../capabilities/index.ts";
import { ThemeEngine } from "../theme/index.ts";
import type { ThemeInput } from "../theme/index.ts";
import type { ResolvedTokens } from "../tokens/index.ts";

/** Shared state holding the active theme engine, terminal capabilities, and resolved tokens. */
export type SystemContext = {
	/** The active theme engine instance. */
	theme: ThemeEngine;
	/** Detected or overridden terminal capabilities. */
	capabilities: TerminalCapabilities;
	/** Design tokens resolved by the theme engine. */
	tokens: ResolvedTokens;
};

let currentContext: SystemContext | null = null;

/**
 * Returns the current system context, auto-initializing with defaults on first use.
 *
 * @returns The active {@link SystemContext}.
 *
 * @example
 * ```ts
 * const ctx = getContext()
 * console.log(ctx.tokens.color.primary)
 * ```
 */
export function getContext(): SystemContext {
	if (!currentContext) {
		// Auto-initialize with defaults on first use
		const capabilities = detectCapabilities();
		const theme = new ThemeEngine(capabilities);
		currentContext = {
			theme,
			capabilities,
			get tokens() {
				return theme.resolvedTokens;
			},
		};
	}
	return currentContext;
}

/**
 * Replaces the current system context with the provided one.
 *
 * @param ctx - The new system context to set as active.
 */
export function setContext(ctx: SystemContext): void {
	currentContext = ctx;
}

/**
 * Creates a new system context with specific capabilities and optional theme input.
 * Useful for testing or rendering in non-default environments.
 *
 * @param capabilities - Partial terminal capabilities to merge with defaults.
 * @param themeInput - Optional theme overrides to apply.
 * @returns A new {@link SystemContext} configured with the given options.
 */
export function createContext(
	capabilities?: Partial<TerminalCapabilities>,
	themeInput?: ThemeInput,
): SystemContext {
	const caps = createCapabilities(capabilities);
	const theme = new ThemeEngine(caps, themeInput);
	return {
		theme,
		capabilities: caps,
		get tokens() {
			return theme.resolvedTokens;
		},
	};
}
