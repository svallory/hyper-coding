/**
 * Rendering Engine
 *
 * ANSI SGR code generation, string width calculation, escape sequence
 * stripping, and ANSI-aware string manipulation utilities.
 */

export { ansiPad, ansiSlice, ansiTruncate, ansiWrap } from "./ansi-utils.ts";
export { applyStyle, type StyleSpec, sgrClose, sgrOpen } from "./sgr.ts";
export { stripAnsi, stripColor } from "./strip.ts";
export { charWidth, stringWidth } from "./width.ts";
