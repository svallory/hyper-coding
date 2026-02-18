/**
 * Display utilities for formatting CLI output
 */

/**
 * Returns the first sentence of text, truncated to maxLen with "..." appended
 * if the result exceeds that length. Strips leading/trailing whitespace.
 */
export function truncateDescription(text: string, maxLen = 80): string {
	const trimmed = text.trim();

	// Extract first sentence: ends at '.', '!', or '?' followed by whitespace or end
	const sentenceMatch = trimmed.match(/^.*?[.!?](?:\s|$)/);
	const sentence = sentenceMatch ? sentenceMatch[0].trim() : trimmed;

	if (sentence.length <= maxLen) {
		return sentence;
	}

	return `${sentence.slice(0, maxLen - 3)}...`;
}

/**
 * The normalized shape of a variable config for display purposes.
 */
export interface NormalizedVariable {
	name: string;
	type?: string;
	required?: boolean;
	defaultValue?: unknown;
	enumValues?: string[];
	description?: string;
}

/**
 * Normalizes a variable config object (from a cookbook/recipe YAML) into a
 * consistent shape suitable for display.
 */
export function formatVariable(name: string, config: Record<string, unknown>): NormalizedVariable {
	const result: NormalizedVariable = { name };

	if (config.type !== undefined) {
		result.type = String(config.type);
	}

	if (config.required !== undefined) {
		result.required = Boolean(config.required);
	}

	// Support both 'default' and 'defaultValue' keys
	if (config.defaultValue !== undefined) {
		result.defaultValue = config.defaultValue;
	} else if (config.default !== undefined) {
		result.defaultValue = config.default;
	}

	// Support both 'enum' and 'enumValues' keys
	if (Array.isArray(config.enumValues)) {
		result.enumValues = config.enumValues.map(String);
	} else if (Array.isArray(config.enum)) {
		result.enumValues = (config.enum as unknown[]).map(String);
	}

	if (config.description !== undefined) {
		result.description = String(config.description);
	}

	return result;
}

/**
 * The resolved result of parsing positional args for an info command.
 */
export interface ResolvedInfoArgs {
	kit?: string;
	cookbook?: string;
	name: string;
}

/**
 * Resolves positional CLI args into a structured lookup key for info commands.
 *
 * For entityType 'recipe':
 *   - 1 arg  → { name: args[0] }
 *   - 2 args → { kit/cookbook: args[0], name: args[1] }
 *   - 3 args → { kit: args[0], cookbook: args[1], name: args[2] }
 *
 * For entityType 'cookbook':
 *   - 1 arg  → { name: args[0] }
 *   - 2 args → { kit: args[0], name: args[1] }
 *
 * The second arg in the 2-arg recipe case is treated as a cookbook name when
 * it contains a "/" and as a kit name otherwise, matching common CLI patterns.
 */
export function resolveInfoArgs(
	args: string[],
	entityType: "cookbook" | "recipe",
): ResolvedInfoArgs {
	if (entityType === "cookbook") {
		if (args.length >= 2) {
			return { kit: args[0], name: args[1] };
		}
		return { name: args[0] };
	}

	// entityType === 'recipe'
	if (args.length >= 3) {
		return { kit: args[0], cookbook: args[1], name: args[2] };
	}

	if (args.length === 2) {
		// Heuristic: if the first arg looks like a cookbook path (contains "/"),
		// treat it as cookbook; otherwise treat as kit.
		const first = args[0];
		if (first.includes("/")) {
			return { cookbook: first, name: args[1] };
		}
		return { kit: first, name: args[1] };
	}

	return { name: args[0] };
}

/**
 * Item shape expected by matchByName.
 */
export interface NamedItem {
	name: string;
	kit?: string;
	cookbook?: string;
}

/**
 * Filters an array of named items by exact name match and optional kit/cookbook
 * filter. Returns all items that satisfy every provided constraint.
 */
export function matchByName<T extends NamedItem>(
	name: string,
	items: T[],
	filter: { kit?: string; cookbook?: string },
): T[] {
	return items.filter((item) => {
		if (item.name !== name) return false;
		if (filter.kit !== undefined && item.kit !== filter.kit) return false;
		if (filter.cookbook !== undefined && item.cookbook !== filter.cookbook) return false;
		return true;
	});
}
