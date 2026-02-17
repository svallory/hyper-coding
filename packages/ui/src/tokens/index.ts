/**
 * Token Engine — Barrel Export
 *
 * Re-exports all token types, default values, and the resolver.
 */

// Types
export type {
	ColorValue,
	ColorTokenValue,
	ColorTokens,
	TypographyStyle,
	TypographyTokens,
	SpacingTokens,
	LayoutTokens,
	SymbolPair,
	SymbolTokens,
	BorderCharSet,
	BorderStyleName,
	BorderTokens,
	TreeCharSet,
	TreeTokens,
	SpinnerDefinition,
	MotionTokens,
	TokenSet,
} from "./types.ts";

// Default values
export { defaultTokens } from "./defaults.ts";

// Resolver
export {
	resolveColor,
	resolveSymbol,
	resolveSpinner,
	resolveTokens,
} from "./resolver.ts";

export type {
	ResolvedColor,
	ResolvedTypographyStyle,
	ResolvedColorTokens,
	ResolvedTypographyTokens,
	ResolvedSymbolTokens,
	ResolvedBorderTokens,
	ResolvedTreeTokens,
	ResolvedSpinnerDefinition,
	ResolvedMotionTokens,
	ResolvedTokens,
} from "./resolver.ts";
