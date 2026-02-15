/**
 * Template Configuration Types
 *
 * Type definitions for template.yml and template variables
 */

export interface TemplateVariable {
	type:
		| "string"
		| "number"
		| "boolean"
		| "enum"
		| "array"
		| "object"
		| "file"
		| "directory";
	required?: boolean;
	multiple?: boolean;
	default?: any;
	/** Suggested value shown in prompts (interactive or AI). Never auto-applied. */
	suggestion?: any;
	description?: string;
	pattern?: string;
	values?: string[];
	min?: number;
	max?: number;
	/** Positional argument index (0-based) for CLI mapping */
	position?: number;
	validation?: {
		message?: string;
	};
}

export interface TemplateExample {
	title: string;
	description?: string;
	variables: Record<string, any>;
}

export interface TemplateInclude {
	url: string;
	version?: string;
	variables?: Record<string, any>; // Variable overrides
	condition?: string; // JavaScript expression for conditional inclusion
	strategy?: "merge" | "replace" | "extend"; // Conflict resolution strategy
}

export interface TemplateDependency {
	name: string;
	version?: string;
	type?: "npm" | "github" | "local" | "http";
	url?: string;
	optional?: boolean;
	dev?: boolean;
}

export interface TemplateConfig {
	name: string;
	description?: string;
	version?: string;
	author?: string;
	category?: string;
	tags?: string[];
	variables: Record<string, TemplateVariable>;
	examples?: TemplateExample[];
	dependencies?: string[] | TemplateDependency[]; // Support both string[] and full dependency objects
	outputs?: string[];
	// Advanced composition features
	extends?: string; // Template inheritance
	includes?: TemplateInclude[]; // Template composition
	conflicts?: {
		strategy: "merge" | "replace" | "extend" | "error";
		rules?: Record<string, "merge" | "replace" | "extend" | "error">;
	};
	// Versioning and compatibility
	engines?: {
		hypergen?: string;
		node?: string;
	};
	// Lifecycle hooks
	hooks?: {
		pre?: string[];
		post?: string[];
		error?: string[];
	};
}

export interface ParsedTemplate {
	config: TemplateConfig;
	filePath: string;
	isValid: boolean;
	errors: string[];
	warnings: string[];
}
