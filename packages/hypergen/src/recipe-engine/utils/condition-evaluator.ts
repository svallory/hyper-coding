/**
 * Condition evaluator utilities for recipe step conditions
 */

import createDebug from 'debug';

const debug = createDebug('hypergen:v8:recipe:condition-evaluator');

/**
 * Create a condition evaluator function with the given base context
 *
 * NOTE: This uses Function constructor which is similar to eval.
 * In the future, consider using a safer expression parser like:
 * - filtrex
 * - expr-eval
 * - jexl
 */
export function createConditionEvaluator(
	baseContext: Record<string, any>,
): (expression: string, additionalContext?: Record<string, any>) => boolean {
	return (expression: string, additionalContext: Record<string, any> = {}) => {
		try {
			// Merge contexts
			const mergedContext = { ...baseContext, ...additionalContext };

			// Create a function that evaluates the expression
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			const func = new Function(
				...Object.keys(mergedContext),
				`return ${expression}`,
			);

			return Boolean(func(...Object.values(mergedContext)));
		} catch (error) {
			debug(
				'Condition evaluation failed: %s - %s',
				expression,
				error instanceof Error ? error.message : String(error),
			);
			return false;
		}
	};
}

/**
 * Evaluate a simple condition expression
 * This is a standalone version that doesn't require a base context
 */
export function evaluateCondition(
	expression: string,
	context: Record<string, any>,
): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const func = new Function(...Object.keys(context), `return ${expression}`);

		return Boolean(func(...Object.values(context)));
	} catch (error) {
		debug(
			'Condition evaluation failed: %s - %s',
			expression,
			error instanceof Error ? error.message : String(error),
		);
		return false;
	}
}
