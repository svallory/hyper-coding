/**
 * Output Expression Evaluator
 *
 * Evaluates step `output` expressions against tool results after step execution.
 * Expressions use Jig template syntax for full flexibility.
 *
 * Example recipe YAML:
 * ```yaml
 * steps:
 *   - name: generate-route
 *     tool: template
 *     template: ./templates/route.jig
 *     output:
 *       update-route-path: "{{ result.filesGenerated[0] }}"
 *       route-name: "{{ result.variables.routeName | kebabCase }}"
 * ```
 */

import createDebug from "debug";
import { renderTemplate } from "#/template-engines/index";
import type { StepContext } from "./types.js";

const debug = createDebug("hypergen:v8:recipe:output-evaluator");

/**
 * Evaluate output expressions from a step's `output` field.
 *
 * @param outputExpressions  Map of variable names to Jig template expressions
 * @param toolResult         The raw result returned by the tool
 * @param context            Current step context (for access to variables etc.)
 * @returns Map of variable name -> evaluated value
 */
export async function evaluateStepOutputs(
	outputExpressions: Record<string, string>,
	toolResult: any,
	context: StepContext,
): Promise<Record<string, any>> {
	const outputs: Record<string, any> = {};

	// Build evaluation context
	const evalContext: Record<string, any> = {
		result: toolResult ?? {},
		step: context.step?.name,
		status: "completed",
		...context.variables,
	};

	for (const [varName, expression] of Object.entries(outputExpressions)) {
		try {
			debug("Evaluating output expression: %s = %s", varName, expression);

			// If the expression looks like a Jig template (contains {{ }}), render it
			if (expression.includes("{{") || expression.includes("@")) {
				const rendered = await renderTemplate(expression, evalContext);
				// Trim whitespace that Jig may add
				const trimmed =
					typeof rendered === "string" ? rendered.trim() : rendered;
				outputs[varName] = trimmed;
			} else {
				// Plain expression — evaluate as property access on the context
				outputs[varName] = evaluateSimpleExpression(expression, evalContext);
			}

			debug("Output evaluated: %s = %o", varName, outputs[varName]);
		} catch (error) {
			debug(
				"Output expression evaluation failed: %s = %s (%s)",
				varName,
				expression,
				error instanceof Error ? error.message : String(error),
			);
			// Set to undefined on error rather than failing the whole step
			outputs[varName] = undefined;
		}
	}

	return outputs;
}

/**
 * Evaluate a simple dot-notation expression against a context.
 * e.g., "result.filesGenerated[0]" or "result.variables.name"
 */
function evaluateSimpleExpression(
	expression: string,
	context: Record<string, any>,
): any {
	try {
		// Use Function constructor for safe(r) expression evaluation
		const keys = Object.keys(context);
		const values = Object.values(context);
		const fn = new Function(...keys, `return ${expression}`);
		return fn(...values);
	} catch {
		return undefined;
	}
}
