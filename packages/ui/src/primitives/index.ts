/**
 * Primitives — Barrel Export
 *
 * The 13 atomic building blocks plus context management.
 */

// Context
export { getContext, setContext, createContext } from "./context.ts";
export type { SystemContext } from "./context.ts";

// Primitives
export { styledText } from "./styledText.ts";
export type { StyledTextOptions } from "./styledText.ts";

export { symbol } from "./symbol.ts";

export { pad } from "./pad.ts";
export type { PadOptions } from "./pad.ts";

export { truncate } from "./truncate.ts";
export type { TruncateOptions } from "./truncate.ts";

export { align } from "./align.ts";
export type { AlignOptions } from "./align.ts";

export { line } from "./line.ts";
export type { LinePart } from "./line.ts";

export { stack } from "./stack.ts";
export type { StackOptions } from "./stack.ts";

export { indent } from "./indent.ts";

export { wrap } from "./wrap.ts";
export type { WrapOptions } from "./wrap.ts";

export { border } from "./border.ts";
export type { BorderOptions } from "./border.ts";

export { divider } from "./divider.ts";
export type { DividerOptions } from "./divider.ts";

export { badge } from "./badge.ts";
export type { BadgeOptions } from "./badge.ts";

export { markdown, defaultMarkdownTheme } from "./markdown.ts";
export type { MarkdownTheme, MarkdownOptions, HeadingStyle } from "./markdown.ts";
