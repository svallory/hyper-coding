/**
 * Test Utilities — Barrel Export
 *
 * Testing helpers for consumers of the CLI Design System.
 * Exported as `cli-ds/test`.
 */

export { render } from "./render.ts";
export type { RenderedOutput } from "./render.ts";

export { mockCapabilities, mockTheme, setupTestContext } from "./mock.ts";
export type { CapabilityPreset } from "./mock.ts";

export { snapshot } from "./snapshot.ts";

export { compareOutput } from "./compare.ts";
export type { ComparisonResult } from "./compare.ts";

// Re-export commonly used utilities
export { stripAnsi } from "../render/index.ts";
export { stringWidth } from "../render/index.ts";
