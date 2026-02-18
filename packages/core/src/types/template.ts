/**
 * Template Configuration Types
 *
 * Type definitions for template.yml and template variables
 */

export interface TemplateVariable {
	type: "string" | "number" | "boolean" | "enum" | "array" | "object" | "file" | "directory";
	required?: boolean;
	multiple?: boolean;
	default?: any;
	/** Suggested value shown in prompts (interactive or AI). Never auto-applied. */
	suggestion?: any;
	/** Prompt question displayed when asking for this variable's value */
	prompt?: string;
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

export interface TemplateConfig {
	name: string;
	description?: string;
	version?: string;
	author?: string;
	category?: string;
	tags?: string[];
	variables: Record<string, TemplateVariable>;
	examples?: TemplateExample[];
	outputs?: string[];
}

export interface ParsedTemplate {
	config: TemplateConfig;
	filePath: string;
	isValid: boolean;
	errors: string[];
	warnings: string[];
}
