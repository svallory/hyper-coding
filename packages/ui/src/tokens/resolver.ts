/**
 * Token Resolver
 *
 * Resolves abstract token values to concrete output values based on
 * detected terminal capabilities. This is the bridge between the
 * semantic token system and the actual ANSI output.
 */

import type { ColorDepth, TerminalCapabilities } from "../capabilities/index.ts";
import type {
	BorderCharSet,
	BorderStyleName,
	BorderTokens,
	ColorTokenValue,
	ColorTokens,
	ColorValue,
	LayoutTokens,
	MotionTokens,
	SpacingTokens,
	SpinnerDefinition,
	SymbolPair,
	SymbolTokens,
	TokenSet,
	TreeCharSet,
	TreeTokens,
	TypographyStyle,
	TypographyTokens,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Resolved Types — mirrors TokenSet with all values resolved
// ---------------------------------------------------------------------------

/** A resolved color: string value or null when color is disabled. */
export type ResolvedColor = string | null;

/** Resolved typography style with the color reference replaced by a resolved color. */
export type ResolvedTypographyStyle = Omit<TypographyStyle, "color"> & {
	color?: ResolvedColor;
};

/** Resolved color tokens: each role maps to a string or null. */
export type ResolvedColorTokens = {
	[K in keyof ColorTokens]: ResolvedColor;
};

/** Resolved typography tokens: each role maps to a resolved style. */
export type ResolvedTypographyTokens = {
	[K in keyof TypographyTokens]: ResolvedTypographyStyle;
};

/** Resolved symbol tokens: each role maps to a single string. */
export type ResolvedSymbolTokens = {
	[K in keyof SymbolTokens]: string;
};

/** Resolved border tokens: a style name and the resolved character set. */
export type ResolvedBorderTokens = {
	style: BorderStyleName;
	styles: Record<BorderStyleName, BorderCharSet>;
	chars: BorderCharSet;
};

/** Resolved tree tokens: a single character set. */
export type ResolvedTreeTokens = TreeCharSet;

/** Resolved spinner: just the frame array for the current capability. */
export type ResolvedSpinnerDefinition = string[];

/** Resolved motion tokens. */
export type ResolvedMotionTokens = {
	spinnerDots: ResolvedSpinnerDefinition;
	spinnerLine: ResolvedSpinnerDefinition;
	spinnerArc: ResolvedSpinnerDefinition;
	progressFilled: string;
	progressPartial: string;
	progressHead: string;
	spinnerInterval: number;
	progressInterval: number;
};

/** The complete resolved token set, ready for use by components. */
export type ResolvedTokens = {
	color: ResolvedColorTokens;
	type: ResolvedTypographyTokens;
	space: SpacingTokens;
	layout: LayoutTokens;
	symbol: ResolvedSymbolTokens;
	border: ResolvedBorderTokens;
	tree: ResolvedTreeTokens;
	motion: ResolvedMotionTokens;
};

// ---------------------------------------------------------------------------
// Individual Resolvers
// ---------------------------------------------------------------------------

/**
 * Resolves a single color token value to a string (or null if color is disabled).
 *
 * - colorDepth 'none' -> null
 * - colorDepth '16' -> the ansi16 name (e.g. 'red')
 * - colorDepth '256' -> the ansi256 index as a string
 * - colorDepth 'truecolor' -> the hex string
 * - Attribute tokens ('dim', 'bold', 'default') pass through as-is.
 *
 * @param token - The color token value to resolve.
 * @param capabilities - Detected terminal capabilities used to pick the right tier.
 * @returns A string representation of the color, or null when color is disabled.
 */
export function resolveColor(
	token: ColorTokenValue,
	capabilities: TerminalCapabilities,
): string | null {
	// Attribute-only tokens pass through regardless of color depth
	if (token === "dim" || token === "bold" || token === "default") {
		return token;
	}

	const depth: ColorDepth = capabilities.colorDepth;

	if (depth === "none") {
		return null;
	}

	// After the attribute guard above, token is narrowed to ColorValue
	switch (depth) {
		case "16":
			return token.ansi16;
		case "256":
			return String(token.ansi256);
		case "truecolor":
			return token.truecolor;
	}
}

/**
 * Resolves a symbol pair to the appropriate glyph based on unicode support.
 *
 * @param token - The symbol pair containing unicode and ascii variants.
 * @param capabilities - Detected terminal capabilities.
 * @returns The unicode or ascii glyph string.
 */
export function resolveSymbol(token: SymbolPair, capabilities: TerminalCapabilities): string {
	return capabilities.unicode ? token.unicode : token.ascii;
}

/**
 * Resolves a spinner definition to the appropriate frame array.
 *
 * @param token - The spinner definition containing unicode and ascii frame arrays.
 * @param capabilities - Detected terminal capabilities.
 * @returns The unicode or ascii frame array.
 */
export function resolveSpinner(
	token: SpinnerDefinition,
	capabilities: TerminalCapabilities,
): string[] {
	return capabilities.unicode ? token.unicode : token.ascii;
}

// ---------------------------------------------------------------------------
// Full Token Set Resolver
// ---------------------------------------------------------------------------

function resolveColorTokens(
	colors: ColorTokens,
	capabilities: TerminalCapabilities,
): ResolvedColorTokens {
	const result = {} as ResolvedColorTokens;
	for (const key of Object.keys(colors) as Array<keyof ColorTokens>) {
		result[key] = resolveColor(colors[key], capabilities);
	}
	return result;
}

function resolveTypographyTokens(
	typography: TypographyTokens,
	colors: ColorTokens,
	capabilities: TerminalCapabilities,
): ResolvedTypographyTokens {
	const result = {} as ResolvedTypographyTokens;
	for (const key of Object.keys(typography) as Array<keyof TypographyTokens>) {
		const style = typography[key];
		const { color: colorRef, ...rest } = style;
		const resolved: ResolvedTypographyStyle = { ...rest };
		if (colorRef !== undefined) {
			resolved.color = resolveColor(colors[colorRef], capabilities);
		}
		result[key] = resolved;
	}
	return result;
}

function resolveSymbolTokens(
	symbols: SymbolTokens,
	capabilities: TerminalCapabilities,
): ResolvedSymbolTokens {
	const result = {} as ResolvedSymbolTokens;
	for (const key of Object.keys(symbols) as Array<keyof SymbolTokens>) {
		result[key] = resolveSymbol(symbols[key], capabilities);
	}
	return result;
}

function resolveBorderTokens(
	border: BorderTokens,
	capabilities: TerminalCapabilities,
): ResolvedBorderTokens {
	// ASCII-only terminals force the ascii border style
	const effectiveStyle: BorderStyleName = capabilities.unicode ? border.style : "ascii";
	return {
		style: effectiveStyle,
		styles: border.styles,
		chars: border.styles[effectiveStyle],
	};
}

function resolveTreeTokens(
	tree: TreeTokens,
	capabilities: TerminalCapabilities,
): ResolvedTreeTokens {
	return capabilities.unicode ? tree.unicode : tree.ascii;
}

function resolveMotionTokens(
	motion: MotionTokens,
	capabilities: TerminalCapabilities,
): ResolvedMotionTokens {
	return {
		spinnerDots: resolveSpinner(motion.spinnerDots, capabilities),
		spinnerLine: resolveSpinner(motion.spinnerLine, capabilities),
		spinnerArc: resolveSpinner(motion.spinnerArc, capabilities),
		progressFilled: resolveSymbol(motion.progressFilled, capabilities),
		progressPartial: resolveSymbol(motion.progressPartial, capabilities),
		progressHead: resolveSymbol(motion.progressHead, capabilities),
		spinnerInterval: motion.spinnerInterval,
		progressInterval: motion.progressInterval,
	};
}

/**
 * Resolves an entire token set against the given terminal capabilities,
 * producing a {@link ResolvedTokens} object where every value is a concrete
 * output-ready value.
 *
 * @param tokens - The complete token set to resolve.
 * @param capabilities - Detected terminal capabilities.
 * @returns A fully resolved token set ready for use by components.
 */
export function resolveTokens(
	tokens: TokenSet,
	capabilities: TerminalCapabilities,
): ResolvedTokens {
	return {
		color: resolveColorTokens(tokens.color, capabilities),
		type: resolveTypographyTokens(tokens.type, tokens.color, capabilities),
		space: tokens.space,
		layout: tokens.layout,
		symbol: resolveSymbolTokens(tokens.symbol, capabilities),
		border: resolveBorderTokens(tokens.border, capabilities),
		tree: resolveTreeTokens(tokens.tree, capabilities),
		motion: resolveMotionTokens(tokens.motion, capabilities),
	};
}
