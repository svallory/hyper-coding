/**
 * Variable resolution logic
 */

import createDebug from 'debug';
import type { ActionLogger } from '../../actions/types.js';
import { TemplateParser } from '../../config/template-parser.js';
import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';
import type { RecipeConfig } from '../types.js';
import { promptForVariable } from './variable-prompter.js';

const debug = createDebug('hypergen:v8:recipe:variables');

/**
 * Resolve all variables for a recipe
 */
export async function resolveVariables(
	recipe: RecipeConfig,
	providedVariables: Record<string, any>,
	skipPrompts: boolean,
	logger?: ActionLogger,
): Promise<Record<string, any>> {
	const resolved: Record<string, any> = {};
	const missingRequired: string[] = [];

	debug('Resolving variables for recipe: %s', recipe.name);

	// Process all defined variables
	for (const [varName, varConfig] of Object.entries(recipe.variables)) {
		let value = providedVariables[varName];

		// Use default if no value provided
		if (value === undefined) {
			value = varConfig.default;
		}

		// Check if required variable is missing
		if (
			varConfig.required &&
			(value === undefined || value === null || value === '')
		) {
			if (skipPrompts) {
				missingRequired.push(varName);
				continue;
			}
			// Prompt for missing required variable
			value = await promptForVariable(varName, varConfig, logger);
		}

		// Validate the value
		if (value !== undefined) {
			const validation = TemplateParser.validateVariableValue(
				varName,
				value,
				varConfig,
			);
			if (!validation.isValid) {
				throw ErrorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					validation.error || `Invalid value for variable: ${varName}`,
					{ variable: varName, value, config: varConfig },
				);
			}
		}

		resolved[varName] = TemplateParser.getResolvedValue(value, varConfig);
	}

	if (missingRequired.length > 0) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			`Missing required variables: ${missingRequired.join(', ')}`,
			{ missingVariables: missingRequired },
		);
	}

	// Add any additional provided variables not defined in recipe
	for (const [varName, value] of Object.entries(providedVariables)) {
		if (!recipe.variables[varName]) {
			resolved[varName] = value;
		}
	}

	debug('Variables resolved successfully: %o', Object.keys(resolved));

	return resolved;
}
