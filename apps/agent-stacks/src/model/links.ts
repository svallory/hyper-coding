import type { Source } from "./types";

/** One part of a line spec: `120` is {from: 120, to: 120}; `150-162` is {from: 150, to: 162}. */
export interface LinePart {
	from: number;
	to: number;
}

/** Split a line spec ("120", "150-162", "120,126") into its parts. Throws on anything else. */
export function parseLineSpec(spec: string): LinePart[] {
	const parts = spec.split(",").map((p) => p.trim());
	return parts.map((part) => {
		const m = /^(\d+)(?:-(\d+))?$/.exec(part);
		if (!m) throw new Error(`Bad line spec "${spec}": "${part}" is not a line or a range.`);
		const from = Number(m[1]);
		const to = m[2] === undefined ? from : Number(m[2]);
		if (from < 1 || to < from)
			throw new Error(`Bad line spec "${spec}": "${part}" is out of order.`);
		return { from, to };
	});
}

/** `:12` or `:12-14`: the text of a line-number slot link. */
export function lineLabel(part: LinePart): string {
	return part.from === part.to ? `:${part.from}` : `:${part.from}-${part.to}`;
}

/** A path ending with `/` names a directory (D22). */
function isDirectory(path: string): boolean {
	return path.endsWith("/");
}

/**
 * The one function that builds a link to a repository. Without a line it targets the file; a
 * line or range adds `?plain=1` (without it GitHub renders Markdown and ignores the anchor);
 * a directory targets the tree, and a line on a directory is a content error.
 */
function sourceHref(source: Source, path: string, part?: LinePart): string {
	const full = `${source.prefix}${path}`;
	if (isDirectory(path)) {
		if (part) throw new Error(`A line on the directory "${path}" is a content error.`);
		return `${source.repo}/tree/${source.commit}/${full}`;
	}
	const base = `${source.repo}/blob/${source.commit}/${full}`;
	if (!part) return base;
	const anchor = part.from === part.to ? `#L${part.from}` : `#L${part.from}-L${part.to}`;
	return `${base}?plain=1${anchor}`;
}

/** One target per comma-separated part of the spec; one target without a spec. */
export function sourceHrefs(source: Source, path: string, line?: string): string[] {
	if (!line) return [sourceHref(source, path)];
	return parseLineSpec(line).map((part) => sourceHref(source, path, part));
}
