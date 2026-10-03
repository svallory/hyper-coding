/**
 * The two rules that make a `@clack/prompts` text prompt able to accept its
 * own default.
 *
 * `validate` runs against the raw input BEFORE clack applies `defaultValue`,
 * so a validator that simply demands a non-empty answer makes Enter
 * unacceptably loop: pressing it re-runs the validator on an empty string and
 * the default is never offered. The fallback therefore has to be something
 * the check accepts, and an empty answer has to resolve to it afterwards.
 */

/** The prompt's `validate`: only a value with no fallback may be rejected. */
export function promptValidation(
	key: string,
	value: string | undefined,
	fallback: string,
): string | undefined {
	return !value?.trim() && !fallback ? `Please provide --${key}.` : undefined;
}

/** What the prompt returns once it is submitted: the answer, else the default. */
export function promptValue(answer: string, fallback: string): string {
	return answer.trim() || fallback;
}
