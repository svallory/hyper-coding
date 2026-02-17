/**
 * Dynamic completion types
 *
 * Type definitions for the dynamic cache and completion context used to
 * resolve kit/cookbook/recipe/variable completions at tab-completion time.
 */

/** A completable entry with a name and optional description. */
export interface CompletionEntry {
	name: string;
	description?: string;
}

/**
 * Cached representation of all installed kits, cookbooks, recipes, and their variables.
 * Serialized to disk as JSON to avoid rescanning on every tab completion.
 */
export interface DynamicCache {
	/** ISO timestamp of when this cache was built */
	builtAt: string;
	/** List of installed kit entries (name + description) */
	kits: CompletionEntry[];
	/** Map of kitName -> cookbook entries */
	cookbooks: Record<string, CompletionEntry[]>;
	/** Map of "kitName:cookbookName" -> recipe entries */
	recipes: Record<string, CompletionEntry[]>;
	/** Map of "kitName:cookbookName:recipeName" -> variable definitions */
	variables: Record<string, VariableCompletion[]>;
}

/**
 * A single variable/flag extracted from a recipe.yml for completion purposes.
 */
export interface VariableCompletion {
	name: string;
	type: string;
	description?: string;
	/** Allowed values for enum-typed variables */
	values?: string[];
	/** Positional argument index (0-based) */
	position?: number;
}

/**
 * Discriminated union describing what level of completion the user is at,
 * based on how many path segments they have typed so far.
 */
export type CompletionContext =
	| { level: "kit"; prefix: string }
	| { level: "cookbook"; kit: string; prefix: string }
	| { level: "recipe"; kit: string; cookbook: string; prefix: string }
	| {
			level: "variable";
			kit: string;
			cookbook: string;
			recipe: string;
			prefix: string;
	  };
