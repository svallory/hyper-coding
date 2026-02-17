/**
 * Theme Engine — Barrel Export
 *
 * Re-exports all theme types, built-in themes, the engine, and utilities.
 */

// Types
export type { DeepPartial, BuiltinThemeName, Theme, ThemeInput } from "./types.ts";

// Built-in themes
export { builtinThemes } from "./builtins.ts";

// Engine
export { ThemeEngine } from "./engine.ts";

// Utilities
export { deepMerge } from "./merge.ts";
