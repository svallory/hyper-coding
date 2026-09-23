/**
 * Theme Engine — Barrel Export
 *
 * Re-exports all theme types, built-in themes, the engine, and utilities.
 */

// Built-in themes
export { builtinThemes } from "./builtins.ts";
// Engine
export { ThemeEngine } from "./engine.ts";
// Utilities
export { deepMerge } from "./merge.ts";
// Types
export type { BuiltinThemeName, DeepPartial, Theme, ThemeInput } from "./types.ts";
