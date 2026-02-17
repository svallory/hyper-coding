/**
 * Theme Engine
 *
 * Composes themes, merges them with default tokens, resolves the result
 * against terminal capabilities, and caches the resolved output.
 */

import type { TerminalCapabilities } from "../capabilities/index.ts";
import type { ResolvedTokens, TokenSet } from "../tokens/index.ts";
import { defaultTokens, resolveTokens } from "../tokens/index.ts";
import { builtinThemes } from "./builtins.ts";
import { deepMerge } from "./merge.ts";
import type { BuiltinThemeName, Theme, ThemeInput } from "./types.ts";

/**
 * Normalizes a single ThemeInput entry (string or object) into a Theme object.
 * If the theme has `extends`, the base theme is resolved first and the
 * extending theme is merged on top.
 */
function resolveTheme(input: BuiltinThemeName | Theme): Theme {
	if (typeof input === "string") {
		return builtinThemes[input];
	}

	if (input.extends) {
		const base = builtinThemes[input.extends];
		return deepMerge(base, input);
	}

	return input;
}

/**
 * Composes a ThemeInput (name, object, or array) into a single merged Theme.
 */
function composeThemes(input: ThemeInput): Theme {
	if (Array.isArray(input)) {
		const resolved = input.map(resolveTheme);
		if (resolved.length === 0) return {};
		return resolved.reduce((acc, theme) => deepMerge(acc, theme));
	}

	return resolveTheme(input);
}

/**
 * Applies a Theme's partial overrides onto the complete default token set,
 * producing a full TokenSet.
 */
function applyThemeToTokens(theme: Theme): TokenSet {
	const overrides: Record<string, unknown> = {};

	if (theme.color) overrides.color = theme.color;
	if (theme.type) overrides.type = theme.type;
	if (theme.space) overrides.space = theme.space;
	if (theme.layout) overrides.layout = theme.layout;
	if (theme.symbol) overrides.symbol = theme.symbol;
	if (theme.border) overrides.border = theme.border;
	if (theme.tree) overrides.tree = theme.tree;
	if (theme.motion) overrides.motion = theme.motion;

	return deepMerge(defaultTokens, overrides as Partial<TokenSet>);
}

/**
 * Manages theme composition, token resolution, and caching.
 *
 * The engine composes one or more theme inputs, merges them onto the default
 * token set, and lazily resolves the result against terminal capabilities.
 * Resolved tokens are cached and invalidated whenever the theme changes.
 */
export class ThemeEngine {
	private tokens: TokenSet;
	private capabilities: TerminalCapabilities;
	private resolved: ResolvedTokens | null = null;
	private currentTheme: Theme;

	/**
	 * @param capabilities - The terminal capabilities to resolve tokens against.
	 * @param themeInput - Optional theme configuration to apply over defaults.
	 */
	constructor(capabilities: TerminalCapabilities, themeInput?: ThemeInput) {
		this.capabilities = capabilities;
		this.currentTheme = themeInput ? composeThemes(themeInput) : {};
		this.tokens = applyThemeToTokens(this.currentTheme);
	}

	/** Get the current resolved tokens. Lazily resolved and cached. */
	get resolvedTokens(): ResolvedTokens {
		if (this.resolved === null) {
			this.resolved = resolveTokens(this.tokens, this.capabilities);
		}
		return this.resolved;
	}

	/** Get the raw merged token set (pre-resolution). */
	get rawTokens(): TokenSet {
		return this.tokens;
	}

	/**
	 * Replace the current theme entirely. Invalidates the resolved token cache.
	 *
	 * @param themeInput - The new theme to apply.
	 */
	setTheme(themeInput: ThemeInput): void {
		this.currentTheme = composeThemes(themeInput);
		this.tokens = applyThemeToTokens(this.currentTheme);
		this.resolved = null;
	}

	/**
	 * Merge a partial theme on top of the current theme. Invalidates the resolved token cache.
	 *
	 * @param partial - Partial theme overrides to merge.
	 */
	mergeTheme(partial: Theme): void {
		this.currentTheme = deepMerge(this.currentTheme, partial);
		this.tokens = applyThemeToTokens(this.currentTheme);
		this.resolved = null;
	}

	/**
	 * Get component-level defaults from the theme.
	 *
	 * @param componentName - The component name to look up.
	 * @returns The component defaults record, or `undefined` if none configured.
	 */
	getComponentDefaults(componentName: string): Record<string, unknown> | undefined {
		return this.currentTheme.components?.[componentName];
	}
}
