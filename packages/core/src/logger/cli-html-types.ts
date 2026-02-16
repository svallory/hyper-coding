/**
 * Corrected cli-html types.
 *
 * The published types in cli-html have incorrect HeadingStyle —
 * they use `marker?: string` but the actual config uses `indicator: { marker, color }`.
 * This module re-exports corrected types.
 */
import type { Config as CliHtmlConfig, Theme as CliHtmlTheme } from "cli-html";

export type { CliHtmlConfig, CliHtmlTheme };

export interface HeadingStyle {
	color?: string;
	indicator?: {
		marker?: string;
		color?: string;
	};
}

/**
 * cli-html Theme with corrected heading types.
 */
export type Theme = Omit<CliHtmlTheme, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"> & {
	h1?: string | HeadingStyle;
	h2?: string | HeadingStyle;
	h3?: string | HeadingStyle;
	h4?: string | HeadingStyle;
	h5?: string | HeadingStyle;
	h6?: string | HeadingStyle;
};

/**
 * cli-html Config with corrected Theme type.
 */
export interface HelpThemeConfig {
	theme?: Theme;
	lineWidth?: CliHtmlConfig["lineWidth"];
	asciiMode?: boolean;
}
