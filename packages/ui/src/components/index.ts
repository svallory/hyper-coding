/**
 * Components — Barrel Export
 *
 * Static UI components built on top of the primitives layer.
 */

export { message } from "./message.ts";
export type { MessageOptions } from "./message.ts";

export { statusList } from "./statusList.ts";
export type { StatusListItem } from "./statusList.ts";

export { table } from "./table.ts";
export type { TableColumn, TableOptions } from "./table.ts";

export { list } from "./list.ts";
export type { ListItem, ListOptions } from "./list.ts";

export { tree } from "./tree.ts";
export type { TreeNode, TreeOptions } from "./tree.ts";

export { keyValue } from "./keyValue.ts";
export type { KeyValueEntry, KeyValueOptions } from "./keyValue.ts";

export { diff } from "./diff.ts";
export type { DiffLine, DiffHunk, DiffOptions } from "./diff.ts";

export { panel } from "./panel.ts";
export type { PanelOptions } from "./panel.ts";

export { columns } from "./columns.ts";
export type { ColumnDef, ColumnsOptions } from "./columns.ts";

export { section } from "./section.ts";
export type { SectionOptions } from "./section.ts";

export { helpLayout } from "./helpLayout.ts";
export type { HelpLayoutOptions } from "./helpLayout.ts";

// Interactive components
export { spinner } from "./spinner.ts";
export type { SpinnerOptions, SpinnerHandle } from "./spinner.ts";

export { progressBar } from "./progressBar.ts";
export type { ProgressBarOptions, ProgressBarHandle } from "./progressBar.ts";

export { textPrompt } from "./textPrompt.ts";
export type { TextPromptOptions } from "./textPrompt.ts";

export { confirmPrompt } from "./confirmPrompt.ts";
export type { ConfirmPromptOptions } from "./confirmPrompt.ts";

export { selectPrompt } from "./selectPrompt.ts";
export type { SelectOption, SelectPromptOptions } from "./selectPrompt.ts";
