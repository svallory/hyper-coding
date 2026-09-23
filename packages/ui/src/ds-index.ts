/**
 * CLI Design System — Public API
 *
 * Two consumption modes:
 * 1. System object (full control): `const ds = createSystem({ theme: 'minimal' })`
 * 2. Standalone functions (zero config): `import { message } from 'cli-ds'`
 */

// ---------------------------------------------------------------------------
// Core factory
// ---------------------------------------------------------------------------

import type { TerminalCapabilities } from "./capabilities/index.ts";
import { createCapabilities, detectCapabilities } from "./capabilities/index.ts";
// Import all components for binding onto the system object
import {
	columns,
	confirmPrompt,
	diff,
	helpLayout,
	keyValue,
	list,
	message,
	panel,
	progressBar,
	section,
	selectPrompt,
	spinner,
	statusList,
	table,
	textPrompt,
	tree,
} from "./components/index.ts";
import type { SystemContext } from "./primitives/context.ts";
import { setContext } from "./primitives/context.ts";
// Import all primitives for binding onto the system object
import {
	align,
	badge,
	border,
	divider,
	indent,
	line,
	pad,
	stack,
	styledText,
	symbol,
	truncate,
	wrap,
} from "./primitives/index.ts";
import type { Theme, ThemeInput } from "./theme/index.ts";
import { ThemeEngine } from "./theme/index.ts";
import type { ResolvedTokens } from "./tokens/index.ts";

/** Configuration options for {@link createSystem}. */
export type SystemOptions = {
	/** Theme configuration: a built-in name, custom theme object, or array to compose. */
	theme?: ThemeInput;
	/** Terminal capability overrides merged onto auto-detected values. */
	capabilities?: Partial<TerminalCapabilities>;
};

/**
 * A fully configured design system instance providing access to all primitives,
 * components, and runtime theme management.
 */
export type DesignSystem = {
	/** Resolved design tokens for the current theme and terminal capabilities. */
	readonly tokens: ResolvedTokens;
	/** Detected or overridden terminal capabilities. */
	readonly capabilities: TerminalCapabilities;
	/** The underlying theme engine managing token resolution and caching. */
	readonly theme: ThemeEngine;

	/** Replace the active theme. Updates all resolved tokens. */
	setTheme(themeInput: ThemeInput): void;
	/** Merge partial overrides into the active theme. */
	mergeTheme(partial: Theme): void;

	// Primitives
	styledText: typeof styledText;
	symbol: typeof symbol;
	pad: typeof pad;
	truncate: typeof truncate;
	align: typeof align;
	line: typeof line;
	stack: typeof stack;
	indent: typeof indent;
	wrap: typeof wrap;
	border: typeof border;
	divider: typeof divider;
	badge: typeof badge;

	// Static components
	message: typeof message;
	statusList: typeof statusList;
	table: typeof table;
	list: typeof list;
	tree: typeof tree;
	keyValue: typeof keyValue;
	diff: typeof diff;
	panel: typeof panel;
	columns: typeof columns;
	section: typeof section;
	helpLayout: typeof helpLayout;

	// Interactive components
	spinner: typeof spinner;
	progressBar: typeof progressBar;
	textPrompt: typeof textPrompt;
	confirmPrompt: typeof confirmPrompt;
	selectPrompt: typeof selectPrompt;
};

/**
 * Creates a fully configured design system instance.
 *
 * Detects (or accepts overridden) terminal capabilities, instantiates
 * a ThemeEngine, sets the global context, and returns an object with
 * all primitives and components bound to that context.
 *
 * @param options - Optional theme and capability configuration.
 * @returns A {@link DesignSystem} instance with all primitives and components.
 */
export function createSystem(options?: SystemOptions): DesignSystem {
	const caps = options?.capabilities
		? createCapabilities(options.capabilities)
		: detectCapabilities();

	const themeEngine = new ThemeEngine(caps, options?.theme);

	const ctx: SystemContext = {
		theme: themeEngine,
		capabilities: caps,
		get tokens() {
			return themeEngine.resolvedTokens;
		},
	};

	// Set as the global context so all standalone functions use this system
	setContext(ctx);

	const system: DesignSystem = {
		// Resolved state — tokens is a live getter that reflects theme changes
		get tokens() {
			return themeEngine.resolvedTokens;
		},
		capabilities: caps,
		theme: themeEngine,

		// Runtime modifications
		setTheme(themeInput: ThemeInput) {
			themeEngine.setTheme(themeInput);
			// Context stays in sync because ctx.tokens is a getter on themeEngine
		},
		mergeTheme(partial: Theme) {
			themeEngine.mergeTheme(partial);
		},

		// Primitives — same functions, they read from the global context
		styledText,
		symbol,
		pad,
		truncate,
		align,
		line,
		stack,
		indent,
		wrap,
		border,
		divider,
		badge,

		// Static components
		message,
		statusList,
		table,
		list,
		tree,
		keyValue,
		diff,
		panel,
		columns,
		section,
		helpLayout,

		// Interactive components
		spinner,
		progressBar,
		textPrompt,
		confirmPrompt,
		selectPrompt,
	};

	return system;
}

// ---------------------------------------------------------------------------
// Standalone re-exports — primitives
// ---------------------------------------------------------------------------

export {
	align,
	badge,
	border,
	divider,
	indent,
	line,
	pad,
	stack,
	styledText,
	symbol,
	truncate,
	wrap,
} from "./primitives/index.ts";

// ---------------------------------------------------------------------------
// Standalone re-exports — components (static)
// ---------------------------------------------------------------------------

export {
	columns,
	diff,
	helpLayout,
	keyValue,
	list,
	message,
	panel,
	section,
	statusList,
	table,
	tree,
} from "./components/index.ts";

// ---------------------------------------------------------------------------
// Standalone re-exports — components (interactive)
// ---------------------------------------------------------------------------

export {
	confirmPrompt,
	progressBar,
	selectPrompt,
	spinner,
	textPrompt,
} from "./components/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — capabilities
// ---------------------------------------------------------------------------

export type { ColorDepth, TerminalCapabilities } from "./capabilities/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — theme
// ---------------------------------------------------------------------------

export type { BuiltinThemeName, Theme, ThemeInput } from "./theme/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — tokens
// ---------------------------------------------------------------------------

export type { ResolvedTokens } from "./tokens/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — render
// ---------------------------------------------------------------------------

export type { StyleSpec } from "./render/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — component options
// ---------------------------------------------------------------------------

export type {
	ColumnDef,
	ColumnsOptions,
	ConfirmPromptOptions,
	DiffHunk,
	DiffLine,
	DiffOptions,
	HelpLayoutOptions,
	KeyValueEntry,
	KeyValueOptions,
	ListItem,
	ListOptions,
	MessageOptions,
	PanelOptions,
	ProgressBarHandle,
	ProgressBarOptions,
	SectionOptions,
	SelectOption,
	SelectPromptOptions,
	SpinnerHandle,
	SpinnerOptions,
	StatusListItem,
	TableColumn,
	TableOptions,
	TextPromptOptions,
	TreeNode,
	TreeOptions,
} from "./components/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — primitive options
// ---------------------------------------------------------------------------

export type {
	AlignOptions,
	BadgeOptions,
	BorderOptions,
	DividerOptions,
	LinePart,
	PadOptions,
	StackOptions,
	StyledTextOptions,
	TruncateOptions,
	WrapOptions,
} from "./primitives/index.ts";

// ---------------------------------------------------------------------------
// Utility re-exports
// ---------------------------------------------------------------------------

export { createCapabilities } from "./capabilities/index.ts";
export { stringWidth, stripAnsi } from "./render/index.ts";

// ---------------------------------------------------------------------------
// Context re-exports (for advanced usage)
// ---------------------------------------------------------------------------

export type { SystemContext } from "./primitives/index.ts";
export { createContext, getContext, setContext } from "./primitives/index.ts";
