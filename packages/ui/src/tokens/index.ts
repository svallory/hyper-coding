/**
 * Token Engine — Barrel Export
 *
 * Re-exports all token types, default values, and the resolver.
 */

// Default values
export { defaultTokens } from "./defaults.ts";
export type {
	ResolvedBorderTokens,
	ResolvedColor,
	ResolvedColorTokens,
	ResolvedMotionTokens,
	ResolvedSpinnerDefinition,
	ResolvedSymbolTokens,
	ResolvedTokens,
	ResolvedTreeTokens,
	ResolvedTypographyStyle,
	ResolvedTypographyTokens,
} from "./resolver.ts";

// Resolver
export {
	resolveColor,
	resolveSpinner,
	resolveSymbol,
	resolveTokens,
} from "./resolver.ts";
// Types
export type {
	BorderCharSet,
	BorderStyleName,
	BorderTokens,
	ColorTokens,
	ColorTokenValue,
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
