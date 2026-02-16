/**
 * Unicode glyphs for CLI output.
 *
 * Consolidated from core/ui/symbols.ts and gen's inline usage.
 */

export const symbols = {
	// Status indicators
	error: "\u00d7", // ×
	warning: "\u25b2", // ▲
	success: "\u2714", // ✔
	info: "\u25cf", // ●
	tip: "\u25c6", // ◆

	// Structural
	bar: "\u2502", // │
	bullet: "\u2022", // •
	dash: "\u2500", // ─
	arrow: "\u25b8", // ▸
	arrowFilled: "\u25b6\ufe0e", // ▶︎
	arrowThin: "\u25b9", // ▹
} as const;
