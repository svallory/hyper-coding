/**
 * Deep Merge Utility
 *
 * Merges objects recursively for theme composition.
 * - Objects merge recursively
 * - Arrays are replaced (not concatenated)
 * - undefined values in overrides are skipped
 * - Primitives (strings, numbers, booleans) are replaced
 */

/**
 * Checks whether a value is a plain object (not an array, null, or other non-object type).
 *
 * @param value - The value to test.
 * @returns `true` if `value` is a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep merges a base object with one or more partial overrides.
 *
 * Each override is applied left-to-right on top of the base. Nested plain
 * objects are merged recursively; arrays, primitives, and `null` are replaced
 * outright. `undefined` values in an override are silently skipped so that
 * sparse partial objects can be applied without erasing existing values.
 *
 * @typeParam T - The shape of the base object. The return type preserves this shape.
 * @param base - The complete base object to merge into. It is not mutated.
 * @param overrides - One or more partial objects whose defined keys are overlaid on `base`.
 * @returns A new object of type `T` with all overrides applied.
 */
export function deepMerge<T extends object>(base: T, ...overrides: Array<Partial<T>>): T {
	let result = structuredClone(base);

	for (const override of overrides) {
		result = mergeTwo(result as Record<string, unknown>, override as Record<string, unknown>) as T;
	}

	return result;
}

/**
 * Merges two plain objects, recursing into nested plain objects.
 *
 * @param base - The base record.
 * @param override - The override record whose defined keys win.
 * @returns A new record with the merge result.
 */
function mergeTwo(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...base };

	for (const key of Object.keys(override)) {
		const overrideValue = override[key];

		// Skip undefined values — only explicit values override
		if (overrideValue === undefined) {
			continue;
		}

		const baseValue = base[key];

		if (isPlainObject(overrideValue) && isPlainObject(baseValue)) {
			// Recurse into nested objects
			result[key] = mergeTwo(baseValue, overrideValue);
		} else {
			// Arrays, primitives, and null are replaced directly
			result[key] = structuredClone(overrideValue);
		}
	}

	return result;
}
