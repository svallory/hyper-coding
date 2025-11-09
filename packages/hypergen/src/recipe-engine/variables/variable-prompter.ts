/**
 * Variable prompting utilities
 */

import type { ActionLogger } from '../../actions/types.js';
import type { TemplateVariable } from '../../config/template-parser.js';
import { TemplateParser } from '../../config/template-parser.js';
import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';
import { performInteractivePrompting } from '../../prompts/interactive-prompts.js';

/**
 * Get prompt type from variable configuration
 */
export function getPromptType(varConfig: TemplateVariable): string {
	switch (varConfig.type) {
		case 'boolean':
			return 'confirm';
		case 'enum':
			return 'list';
		case 'number':
			return 'number';
		case 'file':
			return 'input'; // Could be enhanced with file picker
		case 'directory':
			return 'input'; // Could be enhanced with directory picker
		default:
			return 'input';
	}
}

/**
 * Prompt the user for a variable value
 */
export async function promptForVariable(
	varName: string,
	varConfig: TemplateVariable,
	logger?: ActionLogger,
): Promise<any> {
	const prompts = [
		{
			type: getPromptType(varConfig),
			name: varName,
			message: varConfig.description || `Enter value for ${varName}:`,
			default: varConfig.default,
			choices: varConfig.type === 'enum' ? varConfig.values : undefined,
			validate: (input: any) => {
				const validation = TemplateParser.validateVariableValue(
					varName,
					input,
					varConfig,
				);
				return validation.isValid || validation.error;
			},
		},
	];

	try {
		const answers = await performInteractivePrompting(prompts, {
			log: (message: string) => {
				if (logger) {
					logger.info(message);
				}
			},
		});

		return answers[varName];
	} catch (error) {
		throw ErrorHandler.createError(
			ErrorCode.INTERNAL_ERROR,
			`Failed to prompt for variable ${varName}: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ variable: varName },
		);
	}
}
