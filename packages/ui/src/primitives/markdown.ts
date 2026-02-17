/**
 * markdown Primitive
 *
 * Renders markdown text to styled terminal output. This is the design system's
 * rich text rendering primitive — scope item #16 (Markdown/Rich Text Rendering).
 *
 * The underlying rendering engine is an opaque implementation detail.
 * Consumers interact only with the MarkdownTheme type defined here.
 *
 * Degradation chain:
 * - Truecolor terminals: full color + styling
 * - 256-color terminals: mapped palette
 * - 16-color terminals: named ANSI colors
 * - No color / dumb: plain text passthrough
 */

// Internal implementation — the rendering engine is an opaque dependency
import { renderMarkdown as renderEngine } from "cli-html";

// ---------------------------------------------------------------------------
// Types — these are OUR types, not the engine's
// ---------------------------------------------------------------------------

/** Style specification for a heading level. */
export interface HeadingStyle {
	/** Color specification string (e.g. 'blue bold', 'yellow'). */
	color?: string;
	/** Optional indicator marker shown before the heading. */
	indicator?: {
		/** The marker character (e.g. '▶︎', '▸'). */
		marker?: string;
		/** Color specification for the marker. */
		color?: string;
	};
}

/** Theme for markdown rendering — controls how each element is styled. */
export interface MarkdownTheme {
	/** Heading styles (h1-h6). Can be a color string or full HeadingStyle object. */
	h1?: string | HeadingStyle;
	h2?: string | HeadingStyle;
	h3?: string | HeadingStyle;
	h4?: string | HeadingStyle;
	h5?: string | HeadingStyle;
	h6?: string | HeadingStyle;
	/** Inline code and code block styling. */
	code?: {
		/** Color for inline code spans. */
		color?: string;
		/** Code block styling. */
		block?: {
			/** Color for code block text. */
			color?: string;
			/** Line number configuration. */
			numbers?: { enabled?: boolean };
		};
	};
	/** Table styling. */
	table?: {
		/** Header row styling. */
		header?: { color?: string };
	};
	/** Link styling. */
	a?: { color?: string };
}

/** Options for the markdown rendering function. */
export interface MarkdownOptions {
	/** Custom theme overriding the default. */
	theme?: MarkdownTheme;
}

// ---------------------------------------------------------------------------
// Default theme — Hyper's brand-consistent markdown rendering
// ---------------------------------------------------------------------------

/** The default markdown theme matching HyperDev's brand. */
export const defaultMarkdownTheme: MarkdownTheme = {
	h1: { color: "blue bold", indicator: { marker: "\u25b6\ufe0e", color: "blue bold" } },
	h2: { color: "yellow bold", indicator: { marker: "\u25b8", color: "yellow bold" } },
	h3: { color: "white bold", indicator: { marker: "\u25b9", color: "white bold" } },
	code: {
		color: "hex-4EC9B0",
		block: { color: "gray", numbers: { enabled: false } },
	},
	table: { header: { color: "white bold" } },
	a: { color: "cyan underline" },
};

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/**
 * Renders a markdown string to styled terminal output.
 *
 * This is the design system's rich text primitive. It converts standard
 * markdown (headings, code blocks, tables, links, etc.) into ANSI-styled
 * terminal text using the provided or default theme.
 *
 * @param input - The markdown string to render.
 * @param options - Optional rendering configuration.
 * @returns The styled terminal string.
 *
 * @example
 * ```ts
 * // With defaults
 * console.log(markdown('# Hello\n\nSome **bold** text'))
 *
 * // With custom theme
 * console.log(markdown('# Hello', { theme: { h1: 'green bold' } }))
 * ```
 */
export function markdown(input: string, options?: MarkdownOptions): string {
	const theme = options?.theme ?? defaultMarkdownTheme;
	// The engine accepts the theme object directly — our MarkdownTheme is a
	// strict subset of its internal type, so this cast is safe.
	return renderEngine(input, theme as any);
}
