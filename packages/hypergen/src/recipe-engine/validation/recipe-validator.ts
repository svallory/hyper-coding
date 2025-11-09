/**
 * Main recipe validation
 */

import createDebug from 'debug';
import { RecipeValidationError } from '../types.js';
import type { RecipeConfig, ValidationErrorDetails } from '../types.js';
import { validateDependency } from './dependency-validator.js';
import { validateStep, validateStepDependencies } from './step-validator.js';
import { validateVariable } from './variable-validator.js';

const debug = createDebug('hypergen:v8:recipe:validation');

/**
 * Recipe validation result
 */
export interface RecipeValidationResult {
	isValid: boolean;
	errors: ValidationErrorDetails[];
	warnings: Array<{
		code: string;
		message: string;
		severity: 'warning';
		suggestion?: string;
	}>;
	recipe: RecipeConfig;
	context: {
		timestamp: Date;
		validatorVersion: string;
		scope: string;
	};
}

/**
 * Validate recipe structure
 */
function validateRecipeStructure(
	recipe: RecipeConfig,
): ValidationErrorDetails[] {
	const errors: ValidationErrorDetails[] = [];

	if (!recipe.name || typeof recipe.name !== 'string') {
		errors.push(
			new RecipeValidationError(
				'Recipe name is required and must be a string',
				'MISSING_NAME',
			),
		);
	}

	if (!recipe.variables || typeof recipe.variables !== 'object') {
		errors.push(
			new RecipeValidationError(
				'Recipe variables section is required',
				'MISSING_VARIABLES',
			),
		);
	}

	if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
		errors.push(
			new RecipeValidationError(
				'Recipe must have at least one step',
				'MISSING_STEPS',
			),
		);
	}

	return errors;
}

/**
 * Validate a recipe configuration
 */
export async function validateRecipe(
	recipe: RecipeConfig,
): Promise<RecipeValidationResult> {
	const errors: ValidationErrorDetails[] = [];
	const warnings: string[] = [];

	debug('Validating recipe: %s', recipe.name);

	// Basic structure validation
	errors.push(...validateRecipeStructure(recipe));

	// Validate variables
	if (recipe.variables) {
		for (const [varName, varConfig] of Object.entries(recipe.variables)) {
			const validation = validateVariable(varName, varConfig);
			if (validation.error) {
				errors.push(
					new RecipeValidationError(validation.error, 'INVALID_VARIABLE', {
						field: `variables.${varName}`,
					}),
				);
			}
		}
	}

	// Validate steps
	if (recipe.steps) {
		const stepNames = new Set<string>();

		for (const [index, step] of recipe.steps.entries()) {
			const stepErrors = validateStep(step, index, stepNames);
			errors.push(...stepErrors);
		}

		// Validate step dependencies
		const depErrors = validateStepDependencies(recipe.steps);
		errors.push(...depErrors);
	}

	// Validate dependencies
	if (recipe.dependencies) {
		for (const dep of recipe.dependencies) {
			const depValidation = await validateDependency(dep);
			if (!depValidation.isValid) {
				errors.push(
					new RecipeValidationError(
						`Dependency validation failed: ${dep.name}`,
						'INVALID_DEPENDENCY',
					),
				);
			}
		}
	}

	const result: RecipeValidationResult = {
		isValid: errors.length === 0,
		errors,
		warnings: warnings.map((w) => ({
			code: 'WARNING',
			message: w,
			severity: 'warning' as const,
			suggestion: undefined,
		})),
		recipe,
		context: {
			timestamp: new Date(),
			validatorVersion: '8.0.0',
			scope: 'full',
		},
	};

	debug(
		'Recipe validation completed: %s (errors: %d, warnings: %d)',
		recipe.name,
		errors.length,
		warnings.length,
	);

	return result;
}
