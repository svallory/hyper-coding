/**
 * Rendering Engine
 *
 * ANSI SGR code generation, string width calculation, escape sequence
 * stripping, and ANSI-aware string manipulation utilities.
 */

export { type StyleSpec, sgrOpen, sgrClose, applyStyle } from "./sgr.ts";
export { stripAnsi, stripColor } from "./strip.ts";
export { charWidth, stringWidth } from "./width.ts";
export { ansiTruncate, ansiPad, ansiSlice, ansiWrap } from "./ansi-utils.ts";
