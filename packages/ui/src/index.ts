/**
 * @hypercli/ui — CLI Design System for HyperDev
 *
 * Two consumption modes:
 * 1. Full DS API: `import { createSystem, styledText, message } from '@hypercli/ui'`
 * 2. Quick shortcuts: `import { c, s, msg, md } from '@hypercli/ui/shortcuts'`
 * 3. Markdown rendering: `import { markdown } from '@hypercli/ui'`
 */

// ---------------------------------------------------------------------------
// Auto-initialize the design system with Hyper's brand theme
// ---------------------------------------------------------------------------

import { createSystem } from "./ds-index.ts";
import { hyperTheme } from "./hyper-theme.ts";

// Initialize on import — sets the global context so standalone functions work
createSystem({ theme: hyperTheme });

// ---------------------------------------------------------------------------
// Re-export everything from the DS core
// ---------------------------------------------------------------------------

// Capabilities
export type { ColorDepth, TerminalCapabilities } from "./capabilities/index.ts";
export { createCapabilities } from "./capabilities/index.ts";
// Component option types
export type {
	ColumnDef,
	ColumnsOptions,
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
	SpinnerHandle,
	SpinnerOptions,
	StatusListItem,
	TableColumn,
	TableOptions,
	TreeNode,
	TreeOptions,
} from "./components/index.ts";
// Components (static) — excluding prompt components
// Interactive components (excluding prompts — those stay with clack)
export {
	columns,
	diff,
	helpLayout,
	keyValue,
	list,
	message,
	panel,
	progressBar,
	section,
	spinner,
	statusList,
	table,
	tree,
} from "./components/index.ts";
export type { DesignSystem, SystemOptions } from "./ds-index.ts";
// Core factory
export { createSystem } from "./ds-index.ts";
// Primitive option types
export type {
	AlignOptions,
	BadgeOptions,
	BorderOptions,
	DividerOptions,
	LinePart,
	PadOptions,
	StackOptions,
	StyledTextOptions,
	SystemContext,
	TruncateOptions,
	WrapOptions,
} from "./primitives/index.ts";
// Primitives
// Context
export {
	align,
	badge,
	border,
	createContext,
	defaultMarkdownTheme,
	divider,
	getContext,
	indent,
	line,
	markdown,
	pad,
	setContext,
	stack,
	styledText,
	symbol,
	truncate,
	wrap,
} from "./primitives/index.ts";
// Render
export type { StyleSpec } from "./render/index.ts";
export { stringWidth, stripAnsi } from "./render/index.ts";
// Theme
export type { BuiltinThemeName, Theme, ThemeInput } from "./theme/index.ts";
// Tokens
export type { ResolvedTokens } from "./tokens/index.ts";

// ---------------------------------------------------------------------------
// Hyper-specific exports
// ---------------------------------------------------------------------------

export type { HelpThemeConfig } from "./help.ts";
// Help system (convenience re-exports)
export { helpTheme, renderHelp, renderMarkdown } from "./help.ts";
export { hyperTheme } from "./hyper-theme.ts";
// Markdown primitive types
export type { HeadingStyle, MarkdownOptions, MarkdownTheme } from "./primitives/index.ts";
// Convenience: re-export shortcuts at top level for backwards compat
export { c, md, msg, s } from "./shortcuts.ts";
