/**
 * Token Type Definitions
 *
 * All token types for the CLI Design System. Tokens are named for what they
 * mean, never for what they look like. Every component references tokens
 * by semantic role, and the token engine resolves them to concrete values
 * based on terminal capabilities.
 */

// ---------------------------------------------------------------------------
// Color Tokens
// ---------------------------------------------------------------------------

/** Per-tier color values for capability-aware resolution. */
export type ColorValue = {
	/** Hex color string, e.g. '#f87171' */
	truecolor: string;
	/** 256-color palette index (0-255) */
	ansi256: number;
	/** ANSI 16 color name or attribute: 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'black' | 'dim' | 'bold' */
	ansi16: string;
};

/**
 * A color token value is either a full ColorValue with per-tier fallbacks,
 * or a simple attribute string for tokens that represent styling rather
 * than a specific hue.
 */
export type ColorTokenValue = ColorValue | "dim" | "bold" | "default";

/** Semantic color roles used throughout the design system. */
export type ColorTokens = {
	/** Default foreground text */
	fg: ColorTokenValue;
	/** De-emphasized, secondary text */
	fgMuted: ColorTokenValue;
	/** Errors, failures, destructive actions */
	error: ColorTokenValue;
	/** Warnings, cautions, non-fatal issues */
	warning: ColorTokenValue;
	/** Success, completion, positive outcomes */
	success: ColorTokenValue;
	/** Informational, neutral highlights */
	info: ColorTokenValue;
	/** Interactive elements, links, focus states */
	accent: ColorTokenValue;
	/** High-importance text within a message */
	emphasis: ColorTokenValue;
	/** Inline code, commands, file paths, flags */
	code: ColorTokenValue;
	/** Section headers, titles */
	heading: ColorTokenValue;
	// Background
	/** Error badge background */
	bgError: ColorTokenValue;
	/** Warning badge background */
	bgWarning: ColorTokenValue;
	/** Success badge background */
	bgSuccess: ColorTokenValue;
	/** Info badge background */
	bgInfo: ColorTokenValue;
	/** Selection highlight, search match */
	bgHighlight: ColorTokenValue;
	// Diff
	/** Added lines/content */
	diffAdded: ColorTokenValue;
	/** Removed lines/content */
	diffRemoved: ColorTokenValue;
	/** Unchanged context lines */
	diffContext: ColorTokenValue;
	/** Hunk headers */
	diffHunk: ColorTokenValue;
};

// ---------------------------------------------------------------------------
// Typography Tokens
// ---------------------------------------------------------------------------

/** A combination of ANSI text attributes and an optional color reference. */
export type TypographyStyle = {
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	inverse?: boolean;
	/** Reference to a color token by key name */
	color?: keyof ColorTokens;
};

/** Semantic typography roles. */
export type TypographyTokens = {
	/** Key terms, important values, primary information */
	emphasis: TypographyStyle;
	/** Headings, critical labels */
	strong: TypographyStyle;
	/** Secondary info, timestamps, metadata, hints */
	deEmphasis: TypographyStyle;
	/** Inline code, commands, file paths, flag names */
	code: TypographyStyle;
	/** Clickable URLs */
	link: TypographyStyle;
	/** Removed or deprecated content */
	deleted: TypographyStyle;
	/** Top-level section headers */
	heading1: TypographyStyle;
	/** Sub-section headers */
	heading2: TypographyStyle;
	/** Minor section headers */
	heading3: TypographyStyle;
	/** Key in key-value pairs, column headers */
	label: TypographyStyle;
	/** Supplementary notes, help text */
	caption: TypographyStyle;
};

// ---------------------------------------------------------------------------
// Spacing Tokens
// ---------------------------------------------------------------------------

/** Horizontal and vertical spacing measured in characters/lines. */
export type SpacingTokens = {
	/** Standard indentation per nesting level (characters) */
	indent: number;
	/** Wide indentation for code blocks, deep nesting (characters) */
	indentLarge: number;
	/** Gap between columns (characters) */
	gutter: number;
	/** Gap between major columns (characters) */
	gutterLarge: number;
	/** Inner padding inside boxes (characters) */
	padding: number;
	/** Generous inner padding (characters) */
	paddingLarge: number;
	/** Space between a status icon and its text (characters) */
	iconGap: number;
	/** Items within a dense group (blank lines) */
	lineNone: number;
	/** List items, table rows — no extra spacing (blank lines) */
	lineCompact: number;
	/** Between sections (blank lines) */
	lineNormal: number;
	/** Between major sections of output (blank lines) */
	lineRelaxed: number;
};

/** Layout constraints for content width. */
export type LayoutTokens = {
	/** Maximum content width for readability */
	maxWidth: number;
	/** Minimum width before switching to compact mode */
	minWidth: number;
	/** Assumed width when detection fails */
	defaultWidth: number;
};

// ---------------------------------------------------------------------------
// Symbol Tokens
// ---------------------------------------------------------------------------

/** A pair of glyphs: one for Unicode-capable terminals, one for ASCII-only. */
export type SymbolPair = {
	unicode: string;
	ascii: string;
};

/** Semantic symbol tokens for status, navigation, structure, and interaction. */
export type SymbolTokens = {
	// Status
	/** Operation succeeded */
	success: SymbolPair;
	/** Operation failed */
	error: SymbolPair;
	/** Warning condition */
	warning: SymbolPair;
	/** Informational notice */
	info: SymbolPair;
	/** Not yet started */
	pending: SymbolPair;
	/** In progress (static representation) */
	running: SymbolPair;
	/** Intentionally skipped */
	skipped: SymbolPair;
	/** Tip/suggestion indicator */
	tip: SymbolPair;
	/** Vertical bar for body content connectors */
	bar: SymbolPair;
	// Navigation
	/** Points to, leads to */
	arrowRight: SymbolPair;
	/** Returns to, back */
	arrowLeft: SymbolPair;
	/** Upward, increase */
	arrowUp: SymbolPair;
	/** Downward, decrease */
	arrowDown: SymbolPair;
	/** Current selection, active item */
	pointer: SymbolPair;
	/** Nested indicator */
	pointerSmall: SymbolPair;
	// Structural
	/** List item */
	bullet: SymbolPair;
	/** Separator, range */
	dash: SymbolPair;
	/** Truncation, continuation */
	ellipsis: SymbolPair;
	/** Separator in inline lists */
	middot: SymbolPair;
	// Interactive
	/** Selected radio option */
	radioOn: SymbolPair;
	/** Unselected radio option */
	radioOff: SymbolPair;
	/** Checked checkbox */
	checkboxOn: SymbolPair;
	/** Unchecked checkbox */
	checkboxOff: SymbolPair;
	/** Cursor position in select list */
	cursor: SymbolPair;
};

// ---------------------------------------------------------------------------
// Border Tokens
// ---------------------------------------------------------------------------

/** A complete set of box-drawing characters for one border style. */
export type BorderCharSet = {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
	teeRight: string;
	teeLeft: string;
	teeDown: string;
	teeUp: string;
	cross: string;
};

/** Named border styles shipped with the design system. */
export type BorderStyleName = "rounded" | "single" | "double" | "heavy" | "dashed" | "ascii";

/** Border tokens: a default style and all available style character sets. */
export type BorderTokens = {
	/** The default border style to use */
	style: BorderStyleName;
	/** All available border style character sets */
	styles: Record<BorderStyleName, BorderCharSet>;
};

// ---------------------------------------------------------------------------
// Tree Tokens
// ---------------------------------------------------------------------------

/** Characters for rendering tree structures. */
export type TreeCharSet = {
	/** Intermediate child connector */
	branch: string;
	/** Last child connector */
	last: string;
	/** Continuation line */
	vertical: string;
	/** Indent after last child */
	indent: string;
};

/** Tree drawing tokens with Unicode and ASCII variants. */
export type TreeTokens = {
	unicode: TreeCharSet;
	ascii: TreeCharSet;
};

// ---------------------------------------------------------------------------
// Motion Tokens
// ---------------------------------------------------------------------------

/** Spinner animation frames with Unicode and ASCII variants. */
export type SpinnerDefinition = {
	unicode: string[];
	ascii: string[];
};

/** Motion tokens for animated elements — spinners, progress bars, timing. */
export type MotionTokens = {
	/** Default spinner for indeterminate work */
	spinnerDots: SpinnerDefinition;
	/** Alternative minimal spinner */
	spinnerLine: SpinnerDefinition;
	/** Smooth circular spinner */
	spinnerArc: SpinnerDefinition;
	/** Completed portion of progress bar */
	progressFilled: SymbolPair;
	/** Remaining portion of progress bar */
	progressPartial: SymbolPair;
	/** Leading edge of progress bar */
	progressHead: SymbolPair;
	/** Frame interval for spinners (ms) */
	spinnerInterval: number;
	/** Update interval for progress bars (ms) */
	progressInterval: number;
};

// ---------------------------------------------------------------------------
// Complete Token Set
// ---------------------------------------------------------------------------

/** The complete set of all design tokens. */
export type TokenSet = {
	color: ColorTokens;
	type: TypographyTokens;
	space: SpacingTokens;
	layout: LayoutTokens;
	symbol: SymbolTokens;
	border: BorderTokens;
	tree: TreeTokens;
	motion: MotionTokens;
};
