/**
 * Terminal text for values hyper does not control. A leaf module with no
 * imports, so configuration, allowlist and git code can all share it.
 */

/**
 * What {@link escapeControlCharacters} rewrites: control (Cc) and format (Cf)
 * characters, the line and paragraph separators (neither Cc nor Cf, but both
 * break a line in many renderers), lone surrogates, and the backslash itself.
 */
const ESCAPED_CHARACTERS = /[\\\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu;

/**
 * The ONE rule for text output: every value hyper echoes from a manifest, a
 * remote, a branch name or a path goes through this before it reaches a
 * terminal. `--json` output carries the raw value instead; JSON serialisation
 * is the consumer's escaping, and escaping inside it would make the value
 * unrecoverable.
 *
 * Each control, format or separator character is rendered as `\uXXXX` (BMP)
 * or `\u{XXXXX}` (astral, so `U+E0001` cannot read as `\ue000` then `1`), and
 * a literal backslash as `\\`, so the output is unambiguous: a real file
 * named `a\u202eb` and one carrying U+202E print differently. The result is
 * plain text; quote it with plain double quotes ({@link quoteForTerminal}),
 * never pass it through `JSON.stringify`, which would double every backslash.
 */
export function escapeControlCharacters(value: string): string {
	return value.replace(ESCAPED_CHARACTERS, (character) => {
		if (character === "\\") return "\\\\";
		const code = character.codePointAt(0)!;
		return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
	});
}

/** {@link escapeControlCharacters}, inside plain double quotes. */
export function quoteForTerminal(value: string): string {
	return `"${escapeControlCharacters(value)}"`;
}
