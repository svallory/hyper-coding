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

// Core factory
export { createSystem } from "./ds-index.ts";
export type { SystemOptions, DesignSystem } from "./ds-index.ts";

// Primitives
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
	markdown,
	defaultMarkdownTheme,
} from "./primitives/index.ts";

// Components (static) — excluding prompt components
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

// Interactive components (excluding prompts — those stay with clack)
export {
	spinner,
	progressBar,
} from "./components/index.ts";

// Capabilities
export type { TerminalCapabilities, ColorDepth } from "./capabilities/index.ts";
export { createCapabilities } from "./capabilities/index.ts";

// Theme
export type { Theme, ThemeInput, BuiltinThemeName } from "./theme/index.ts";

// Tokens
export type { ResolvedTokens } from "./tokens/index.ts";

// Render
export type { StyleSpec } from "./render/index.ts";
export { stripAnsi, stringWidth } from "./render/index.ts";

// Context
export { getContext, setContext, createContext } from "./primitives/index.ts";
export type { SystemContext } from "./primitives/index.ts";

// Component option types
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

// Primitive option types
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
// Hyper-specific exports
// ---------------------------------------------------------------------------

export { hyperTheme } from "./hyper-theme.ts";

// Convenience: re-export shortcuts at top level for backwards compat
export { c, s, msg, md } from "./shortcuts.ts";

// Markdown primitive types
export type { MarkdownTheme, MarkdownOptions, HeadingStyle } from "./primitives/index.ts";

// Help system (convenience re-exports)
export { renderHelp, renderMarkdown, helpTheme } from "./help.ts";
export type { HelpThemeConfig } from "./help.ts";
