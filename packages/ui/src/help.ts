/**
 * Help System — Subpath re-exports for @hypercli/ui/help
 *
 * Provides convenience re-exports of the markdown primitive under
 * help-oriented names for the CLI help rendering use case.
 * No third-party types are exposed — everything is defined by the DS.
 */

import { defaultMarkdownTheme, markdown } from "./primitives/markdown.ts";
import type { HeadingStyle, MarkdownOptions, MarkdownTheme } from "./primitives/markdown.ts";

// ---------------------------------------------------------------------------
// Re-export types
// ---------------------------------------------------------------------------

export type { MarkdownTheme, MarkdownOptions, HeadingStyle };

/** @deprecated Use MarkdownTheme instead. */
export type HelpTheme = MarkdownTheme;

/** Configuration for help rendering. */
export interface HelpThemeConfig {
	theme?: MarkdownTheme;
	lineWidth?: { max?: number; min?: number };
	asciiMode?: boolean;
}

// ---------------------------------------------------------------------------
// Default theme
// ---------------------------------------------------------------------------

/** The default help theme. Alias for defaultMarkdownTheme. */
export const helpTheme: HelpThemeConfig = {
	lineWidth: { max: 100 },
	theme: defaultMarkdownTheme,
};

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

/**
 * Render markdown for help output using the default or custom theme.
 */
export function renderHelp(input: string, config?: HelpThemeConfig): string {
	const theme = config?.theme ?? defaultMarkdownTheme;
	return markdown(input, { theme });
}

/**
 * Render markdown with an optional theme.
 * If no theme is given, uses the default markdown theme.
 */
export function renderMarkdown(input: string, theme?: MarkdownTheme): string {
	return markdown(input, theme ? { theme } : undefined);
}
