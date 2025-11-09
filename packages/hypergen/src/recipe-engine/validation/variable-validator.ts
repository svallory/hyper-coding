/**
 * Variable validation functions
 */

import type { TemplateVariable } from '../../config/template-parser.js';

/**
 * Validate a single variable configuration
 */
export function validateVariable(
	varName: string,
	varConfig: TemplateVariable,
): { error?: string } {
	if (!varConfig || typeof varConfig !== 'object') {
		return { error: `Variable '${varName}' must be an object` };
	}

	if (!varConfig.type) {
		return { error: `Variable '${varName}' must have a type` };
	}

	const validTypes = [
		'string',
		'number',
		'boolean',
		'enum',
		'array',
		'object',
		'file',
		'directory',
	];

	if (!validTypes.includes(varConfig.type)) {
		return {
			error: `Variable '${varName}' has invalid type: ${varConfig.type}`,
		};
	}

	return {};
}
