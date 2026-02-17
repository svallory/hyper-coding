/**
 * tree Component
 *
 * Renders a tree structure with branch connectors using resolved tree tokens.
 */

import { getContext, styledText } from "../primitives/index.ts";

/** A node in a tree structure. */
export type TreeNode = {
	/** Display label for this node. */
	label: string;
	/** Child nodes. */
	children?: TreeNode[];
};

/** Options for rendering a tree. */
export type TreeOptions = {
	/** Maximum tree depth to render. Omit for unlimited. */
	maxDepth?: number;
	/** Append child count in parentheses after nodes with children. */
	showCounts?: boolean;
	/** Custom formatting function for node labels. */
	formatNode?: (node: TreeNode) => string;
};

/**
 * Renders a tree structure with branch connectors using resolved tree tokens.
 *
 * @param root - The root node of the tree.
 * @param options - Tree rendering configuration.
 * @returns The formatted tree as a multi-line string.
 */
export function tree(root: TreeNode, options?: TreeOptions): string {
	const ctx = getContext();
	const chars = ctx.tokens.tree;
	const maxDepth = options?.maxDepth;
	const showCounts = options?.showCounts ?? false;
	const formatNode = options?.formatNode;

	const lines: string[] = [];

	function formatLabel(node: TreeNode): string {
		let label = formatNode ? formatNode(node) : node.label;
		if (showCounts && node.children && node.children.length > 0) {
			label += styledText(` (${node.children.length})`, { dim: true });
		}
		return label;
	}

	// Render root
	lines.push(formatLabel(root));

	function renderChildren(children: TreeNode[], prefix: string, depth: number): void {
		if (maxDepth !== undefined && depth >= maxDepth) return;

		for (let i = 0; i < children.length; i++) {
			const child = children[i]!;
			const isLast = i === children.length - 1;
			const connector = isLast ? chars.last : chars.branch;
			const continuation = isLast ? chars.indent : chars.vertical;

			lines.push(`${prefix + connector} ${formatLabel(child)}`);

			if (child.children && child.children.length > 0) {
				renderChildren(child.children, prefix + continuation, depth + 1);
			}
		}
	}

	if (root.children && root.children.length > 0) {
		renderChildren(root.children, "", 0);
	}

	return lines.join("\n");
}
