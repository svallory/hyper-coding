/**
 * Dependency validation functions
 */

/**
 * Validate a recipe dependency
 */
export async function validateDependency(
	dependency: any,
): Promise<{ isValid: boolean; error?: string }> {
	const name = typeof dependency === 'string' ? dependency : dependency.name;

	if (!name) {
		return { isValid: false, error: 'Dependency must have a name' };
	}

	// Basic validation - in production you'd check if package/URL exists
	// Future enhancements could include:
	// - Checking if npm package exists
	// - Verifying URL accessibility
	// - Validating version constraints
	return { isValid: true };
}
