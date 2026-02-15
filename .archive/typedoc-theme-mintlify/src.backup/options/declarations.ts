import { ParameterType } from "typedoc";

/**
 * Controls whether to generate Mintlify frontmatter in MDX files.
 * When enabled, adds YAML frontmatter with title and description.
 */
export const mintlifyFrontmatter = {
	help: "Generate Mintlify-compatible frontmatter in MDX files.",
	type: ParameterType.Boolean,
	defaultValue: true,
};

/**
 * Controls component transformations for better code documentation UX.
 * When enabled, transforms markdown elements to appropriate Mintlify components.
 */
export const mintlifyComponents = {
	help: "Transform markdown to use Mintlify components for better UX.",
	type: ParameterType.Boolean,
	defaultValue: true,
};

/**
 * Controls whether to organize complex class/interface members using Expandable components.
 */
export const useExpandableForMembers = {
	help: "Use Expandable components to organize class/interface members.",
	type: ParameterType.Boolean,
	defaultValue: true,
};

/**
 * Controls whether to group multiple function overloads using Accordion components.
 */
export const useAccordionForOverloads = {
	help: "Use Accordion components for multiple function overloads.",
	type: ParameterType.Boolean,
	defaultValue: true,
};

/**
 * Controls whether to enhance code blocks with better TypeScript formatting.
 */
export const enhanceCodeBlocks = {
	help: "Enhance code blocks with better TypeScript formatting.",
	type: ParameterType.Boolean,
	defaultValue: true,
};

/**
 * Controls whether to include file extensions in navigation items.
 */
export const mintlifyIncludeFileExtensions = {
	help: "Include file extensions (.ts, .js) in navigation items when using file-based grouping.",
	type: ParameterType.Boolean,
	defaultValue: false,
};

/**
 * Path to the Mintlify docs.json file to update with generated SDK navigation.
 * When provided, automatically updates the navigation structure.
 */
export const mintlifyDocsJsonPath = {
	help: "Path to Mintlify docs.json file for automatic navigation updates.",
	type: ParameterType.String,
};

/**
 * The tab name in docs.json where SDK reference pages should be added.
 * Defaults to "SDK Reference".
 */
export const mintlifyTabName = {
	help: "Tab name in docs.json for SDK reference pages.",
	type: ParameterType.String,
	defaultValue: "SDK Reference",
};

/**
 * Controls how the navigation structure is organized.
 * Allowed values: 'folder', 'file', 'kind'
 * - 'folder': Group by source directory structure
 * - 'file': Group by source file structure
 * - 'kind': Group by reflection kind (classes, interfaces, functions, etc.)
 * Defaults to ['folder', 'file']
 */
export const mintlifyNavigation = {
	help: "Navigation organization strategy. Allowed: folder, file, kind",
	type: ParameterType.Array,
	defaultValue: ["folder", "file"],
};

/**
 * Controls which navigation levels should show icons.
 * Allowed values: 'folder', 'file', 'kind', 'all', 'none'
 * - 'folder': Show icons only for folder-level groups
 * - 'file': Show icons only for file-level groups
 * - 'kind': Show icons only for kind-level groups (classes, interfaces, etc.)
 * - 'all': Show icons for all navigation levels
 * - 'none': Show no icons
 * Defaults to 'kind' - only show icons for TypeScript constructs
 */
export const mintlifySidebarIcons = {
	help: "Control which navigation levels show icons. Allowed: folder, file, kind, all, none",
	type: ParameterType.String,
	defaultValue: "kind",
};
