/**
 * ID generation utilities for recipe execution tracking
 */

let executionCounter = 0;

/**
 * Generate a unique execution ID
 */
export function generateExecutionId(): string {
	return `recipe_${Date.now()}_${++executionCounter}`;
}

/**
 * Reset the execution counter (useful for testing)
 */
export function resetExecutionCounter(): void {
	executionCounter = 0;
}
