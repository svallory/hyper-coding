// @hypercli/ui — CLI Design System for HyperDev

// Layer 0: Raw values
export { palette } from "./palette.js";

// Layer 1: Semantic mappings
export { tokens } from "./tokens.js";
export { symbols } from "./symbols.js";

// Layer 2: Styling functions
export { c } from "./colors.js";
export { s } from "./styles.js";
export { md } from "./md.js";

// Layer 3: Structured output
export { msg } from "./messages.js";
export { helpTheme } from "./theme.js";

// Re-export renderMarkdown for help system consumers
export { renderMarkdown } from "cli-html";

// Types
export type { HeadingStyle, Theme, HelpThemeConfig, CliHtmlConfig, CliHtmlTheme } from "./types.js";
