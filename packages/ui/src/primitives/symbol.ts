/**
 * symbol Primitive
 *
 * Returns the resolved symbol glyph (unicode or ascii) for a given
 * semantic symbol name.
 */

import type { SymbolTokens } from "../tokens/index.ts";
import { getContext } from "./context.ts";

/**
 * Returns the resolved glyph for a semantic symbol name.
 *
 * @param name - The symbol token name to resolve (e.g. `'tick'`, `'cross'`).
 * @returns The resolved glyph string (unicode or ascii depending on capabilities).
 */
export function symbol(name: keyof SymbolTokens): string {
	const ctx = getContext();
	return ctx.tokens.symbol[name];
}
