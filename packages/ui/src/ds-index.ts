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

import { createCapabilities, detectCapabilities } from "./capabilities/index.ts";
import type { TerminalCapabilities } from "./capabilities/index.ts";
import { setContext } from "./primitives/context.ts";
import type { SystemContext } from "./primitives/context.ts";
import { ThemeEngine } from "./theme/index.ts";
import type { Theme, ThemeInput } from "./theme/index.ts";
import type { ResolvedTokens } from "./tokens/index.ts";

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
} from "./primitives/index.ts";

// ---------------------------------------------------------------------------
// Standalone re-exports — components (static)
// ---------------------------------------------------------------------------

export {
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
} from "./components/index.ts";

// ---------------------------------------------------------------------------
// Standalone re-exports — components (interactive)
// ---------------------------------------------------------------------------

export {
	spinner,
	progressBar,
	textPrompt,
	confirmPrompt,
	selectPrompt,
} from "./components/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — capabilities
// ---------------------------------------------------------------------------

export type { TerminalCapabilities, ColorDepth } from "./capabilities/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — theme
// ---------------------------------------------------------------------------

export type { Theme, ThemeInput, BuiltinThemeName } from "./theme/index.ts";

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

export type { MessageOptions } from "./components/index.ts";
export type { StatusListItem } from "./components/index.ts";
export type { TableColumn, TableOptions } from "./components/index.ts";
export type { ListItem, ListOptions } from "./components/index.ts";
export type { TreeNode, TreeOptions } from "./components/index.ts";
export type { KeyValueEntry, KeyValueOptions } from "./components/index.ts";
export type { DiffLine, DiffHunk, DiffOptions } from "./components/index.ts";
export type { PanelOptions } from "./components/index.ts";
export type { ColumnDef, ColumnsOptions } from "./components/index.ts";
export type { SectionOptions } from "./components/index.ts";
export type { HelpLayoutOptions } from "./components/index.ts";
export type { SpinnerOptions, SpinnerHandle } from "./components/index.ts";
export type { ProgressBarOptions, ProgressBarHandle } from "./components/index.ts";
export type { TextPromptOptions } from "./components/index.ts";
export type { ConfirmPromptOptions } from "./components/index.ts";
export type { SelectOption, SelectPromptOptions } from "./components/index.ts";

// ---------------------------------------------------------------------------
// Type re-exports — primitive options
// ---------------------------------------------------------------------------

export type { StyledTextOptions } from "./primitives/index.ts";
export type { PadOptions } from "./primitives/index.ts";
export type { TruncateOptions } from "./primitives/index.ts";
export type { AlignOptions } from "./primitives/index.ts";
export type { LinePart } from "./primitives/index.ts";
export type { StackOptions } from "./primitives/index.ts";
export type { WrapOptions } from "./primitives/index.ts";
export type { BorderOptions } from "./primitives/index.ts";
export type { DividerOptions } from "./primitives/index.ts";
export type { BadgeOptions } from "./primitives/index.ts";

// ---------------------------------------------------------------------------
// Utility re-exports
// ---------------------------------------------------------------------------

export { stripAnsi, stringWidth } from "./render/index.ts";
export { createCapabilities } from "./capabilities/index.ts";

// ---------------------------------------------------------------------------
// Context re-exports (for advanced usage)
// ---------------------------------------------------------------------------

export { getContext, setContext, createContext } from "./primitives/index.ts";
export type { SystemContext } from "./primitives/index.ts";
