/**
 * Theme Type Definitions
 *
 * Defines the shape of themes in the CLI Design System. Themes are partial
 * token overrides that compose on top of the default token set.
 */

import type {
	BorderTokens,
	ColorTokens,
	LayoutTokens,
	MotionTokens,
	SpacingTokens,
	SymbolTokens,
	TreeTokens,
	TypographyTokens,
} from "../tokens/index.ts";

/** Deep partial utility — recursively makes all properties optional. */
export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Names of built-in themes shipped with the design system. */
export type BuiltinThemeName = "default" | "minimal" | "highContrast" | "monochrome";

/**
 * A theme is a partial token override. Only the tokens that differ from
 * the base need to be specified. Themes can extend a built-in theme and
 * include component-level defaults.
 */
export type Theme = {
	name?: string;
	extends?: BuiltinThemeName;
	meta?: {
		description?: string;
		author?: string;
		version?: string;
	};
	color?: Partial<ColorTokens>;
	type?: Partial<TypographyTokens>;
	space?: Partial<SpacingTokens>;
	layout?: Partial<LayoutTokens>;
	symbol?: Partial<SymbolTokens>;
	border?: Partial<BorderTokens>;
	tree?: Partial<TreeTokens>;
	motion?: Partial<MotionTokens>;
	components?: Record<string, Record<string, unknown>>;
};

/**
 * Theme input accepted by the ThemeEngine. Can be:
 * - A built-in theme name string
 * - A custom Theme object
 * - An array of themes composed left-to-right
 */
export type ThemeInput = BuiltinThemeName | Theme | Array<BuiltinThemeName | Theme>;
