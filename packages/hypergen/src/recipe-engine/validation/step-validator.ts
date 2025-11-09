/**
 * Step validation functions
 */

import type { RecipeStepUnion, ValidationErrorDetails } from '../types.js';
import { RecipeValidationError } from '../types.js';

/**
 * Validate a single recipe step
 */
export function validateStep(
	step: RecipeStepUnion,
	index: number,
	stepNames: Set<string>,
): ValidationErrorDetails[] {
	const errors: ValidationErrorDetails[] = [];

	if (step.name) {
		if (stepNames.has(step.name)) {
			errors.push(
				new RecipeValidationError(
					`Duplicate step name: ${step.name}`,
					'DUPLICATE_STEP_NAME',
					{ field: `steps[${index}].name` },
				),
			);
		}
		stepNames.add(step.name);
	} else {
		errors.push(
			new RecipeValidationError(
				`Step ${index + 1} must have a name`,
				'MISSING_STEP_NAME',
				{ field: `steps[${index}].name` },
			),
		);
	}

	if (!step.tool) {
		errors.push(
			new RecipeValidationError(
				`Step ${step.name || index + 1} must specify a tool`,
				'MISSING_TOOL',
				{ field: `steps[${index}].tool` },
			),
		);
	}

	const validTools = ['template', 'action', 'codemod', 'recipe'];
	if (step.tool && !validTools.includes(step.tool)) {
		errors.push(
			new RecipeValidationError(
				`Step ${step.name || index + 1} has invalid tool: ${step.tool}`,
				'INVALID_TOOL',
				{ field: `steps[${index}].tool` },
			),
		);
	}

	return errors;
}

/**
 * Validate step dependencies (ensure referenced steps exist)
 */
export function validateStepDependencies(
	steps: RecipeStepUnion[],
): ValidationErrorDetails[] {
	const errors: ValidationErrorDetails[] = [];
	const stepNames = new Set(steps.map((s) => s.name));

	for (const step of steps) {
		if (step.dependsOn) {
			for (const depName of step.dependsOn) {
				if (!stepNames.has(depName)) {
					errors.push(
						new RecipeValidationError(
							`Step ${step.name} depends on unknown step: ${depName}`,
							'UNKNOWN_DEPENDENCY',
							{ step: step.name, field: 'dependsOn' },
						),
					);
				}
			}
		}
	}

	return errors;
}
