/**
 * Primitives — Barrel Export
 *
 * The 13 atomic building blocks plus context management.
 */

export type { AlignOptions } from "./align.ts";
export { align } from "./align.ts";
export type { BadgeOptions } from "./badge.ts";
export { badge } from "./badge.ts";
export type { BorderOptions } from "./border.ts";
export { border } from "./border.ts";
export type { SystemContext } from "./context.ts";
// Context
export { createContext, getContext, setContext } from "./context.ts";
export type { DividerOptions } from "./divider.ts";
export { divider } from "./divider.ts";
export { indent } from "./indent.ts";
export type { LinePart } from "./line.ts";
export { line } from "./line.ts";
export type { HeadingStyle, MarkdownOptions, MarkdownTheme } from "./markdown.ts";
export { defaultMarkdownTheme, markdown } from "./markdown.ts";
export type { PadOptions } from "./pad.ts";
export { pad } from "./pad.ts";
export type { StackOptions } from "./stack.ts";
export { stack } from "./stack.ts";
export type { StyledTextOptions } from "./styledText.ts";
// Primitives
export { styledText } from "./styledText.ts";
export { symbol } from "./symbol.ts";
export type { TruncateOptions } from "./truncate.ts";
export { truncate } from "./truncate.ts";
export type { WrapOptions } from "./wrap.ts";
export { wrap } from "./wrap.ts";
