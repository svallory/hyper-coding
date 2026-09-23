/**
 * Test Utilities — Barrel Export
 *
 * Testing helpers for consumers of the CLI Design System.
 * Exported as `cli-ds/test`.
 */

// Re-export commonly used utilities
export { stringWidth, stripAnsi } from "../render/index.ts";
export type { ComparisonResult } from "./compare.ts";
export { compareOutput } from "./compare.ts";
export type { CapabilityPreset } from "./mock.ts";
export { mockCapabilities, mockTheme, setupTestContext } from "./mock.ts";
export type { RenderedOutput } from "./render.ts";
export { render } from "./render.ts";
export { snapshot } from "./snapshot.ts";
