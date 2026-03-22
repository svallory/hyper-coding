const BOOLEAN_TRUE = new Set(["true", "1", "yes"]);
const BOOLEAN_FALSE = new Set(["false", "0", "no"]);

/**
 * Coerce a CLI string value to its most likely native type.
 * Converts boolean-like strings (true/false/yes/no/1/0) to booleans
 * and numeric strings to numbers.
 */
export function coerceValue(value: string): unknown {
	const lower = value.toLowerCase();
	if (BOOLEAN_TRUE.has(lower)) return true;
	if (BOOLEAN_FALSE.has(lower)) return false;

	if (value !== "" && !Number.isNaN(Number(value))) return Number(value);

	return value;
}
