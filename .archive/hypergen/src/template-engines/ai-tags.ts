/**
 * AI Tags for 2-Pass Generation
 *
 * Registers @ai, @context, @prompt, and @output tags with the Jig (Edge.js) engine.
 *
 * In the 2-pass system:
 *   Pass 1 (collect mode): @ai blocks render their children to collect
 *          prompt/context/output specs via __hypergenAiCollect. No template
 *          output is produced.
 *   Pass 2 (answers mode): @ai blocks skip children entirely and resolve
 *          from state.answers[key]. This prevents errors from variables
 *          that only exist during collection.
 *
 * @context outside @ai adds global context via __hypergenAddGlobalContext.
 *
 * Compile strategy:
 *   The @ai tag extracts the `key` from its own argument (e.g. @ai({ key: 'x' })).
 *   Children are compiled into a conditional block that only runs during Pass 1.
 *   In Pass 2, the tag skips children and outputs state.answers[key] directly.
 */

import type { Edge } from "@jig-lang/jig";
import createDebug from "debug";

const debug = createDebug("hypergen:template:ai-tags");

/**
 * Register all 2-pass AI tags with a Jig (Edge) instance.
 */
export function registerAiTags(edge: Edge): void {
	registerAiTag(edge);
	registerContextTag(edge);
	registerPromptTag(edge);
	registerOutputTag(edge);
	registerExampleTag(edge);
	debug("Registered @ai, @context, @prompt, @output, @example tags");
}

/**
 * @ai — Block container for AI generation.
 *
 * Usage: @ai({ key: 'myKey' })
 *
 * The key identifies this AI block across both passes. It is required.
 *
 * Pass 1 (collect): renders children to populate __aiBlock, then calls
 *   __hypergenAiCollect with the collected data. Produces no template output.
 * Pass 2 (resolve): skips children entirely, outputs state.answers[key].
 */
function registerAiTag(edge: Edge): void {
	edge.registerTag({
		tagName: "ai",
		block: true,
		seekable: true,

		compile(parser, buffer, token) {
			const line = token.loc.start.line;
			const jsArg = token.properties.jsArg.trim();

			// Open a block scope so variables don't leak between @ai blocks
			buffer.writeStatement("{", token.filename, line);

			// Extract key from @ai argument at runtime
			// Supports: @ai({ key: 'x' }) or @ai('x')
			if (jsArg) {
				buffer.writeStatement(`let __aiArgs = ${jsArg};`, token.filename, line);
				buffer.writeStatement(
					`let __aiKey = (typeof __aiArgs === 'string') ? __aiArgs : (__aiArgs.key || '');`,
					token.filename,
					line,
				);
			} else {
				buffer.writeStatement(`let __aiKey = '';`, token.filename, line);
			}

			const escapedFilename = JSON.stringify(token.filename || "unknown");

			// --- Pass 1: collect mode — render children, collect data ---
			buffer.writeStatement("if (state.__hypergenCollectMode) {", token.filename, line);

			// Create the block data object that child tags will populate
			buffer.writeStatement(
				`  let __aiBlock = { contexts: [], prompt: '', key: __aiKey, outputDesc: '', typeHint: '', examples: [] };`,
				token.filename,
				line,
			);

			// Process children inside the collect-mode branch only
			for (const child of token.children) {
				parser.processToken(child, buffer);
			}

			// Collect the block
			buffer.writeStatement(
				`  state.__hypergenAiCollect(__aiBlock.key, __aiBlock.contexts, __aiBlock.prompt, __aiBlock.outputDesc, __aiBlock.typeHint, __aiBlock.examples, ${escapedFilename});`,
				token.filename,
				line,
			);
			// Set the key as a state variable with the first example's value
			// so templates that reference the key can still render during pass 1
			buffer.writeStatement(
				"  if (__aiBlock.key) { state[__aiBlock.key] = (__aiBlock.examples.length > 0 ? __aiBlock.examples[0].trim() : __aiBlock.outputDesc.trim()); }",
				token.filename,
				line,
			);

			// --- Pass 2: answers mode — skip children, output answer ---
			buffer.writeStatement("} else {", token.filename, -1);
			buffer.writeStatement(
				`  let __aiAnswer = (state.answers && state.answers[__aiKey]) || '';`,
				token.filename,
				line,
			);
			buffer.writeStatement("  out += __aiAnswer;", token.filename, line);
			// Also set the key as a state variable for downstream usage
			buffer.writeStatement(
				"  if (__aiKey) { state[__aiKey] = __aiAnswer; }",
				token.filename,
				line,
			);
			buffer.writeStatement("}", token.filename, -1);

			// Close the block scope
			buffer.writeStatement("}", token.filename, -1);
		},
	});
}

/**
 * @context — Block tag.
 *
 * Inside @ai: pushes rendered body to __aiBlock.contexts.
 * Outside @ai (standalone): calls __hypergenAddGlobalContext.
 *
 * Detection: checks if __aiBlock is defined at runtime.
 */
function registerContextTag(edge: Edge): void {
	edge.registerTag({
		tagName: "context",
		block: true,
		seekable: true,

		compile(parser, buffer, token) {
			const line = token.loc.start.line;

			// Create a child buffer to capture the rendered body
			const captureVar = `__ctxBody_${line}`;
			const childBuffer = buffer.create(token.filename, {
				outputVar: captureVar,
			});

			for (const child of token.children) {
				parser.processToken(child, childBuffer);
			}

			// Flush child buffer — this declares captureVar and fills it
			buffer.writeStatement(
				childBuffer
					.disableFileAndLineVariables()
					.disableReturnStatement()
					.disableTryCatchBlock()
					.flush(),
				token.filename,
				line,
			);

			// Runtime: inside @ai or standalone?
			buffer.writeStatement(`if (typeof __aiBlock !== 'undefined') {`, token.filename, line);
			buffer.writeStatement(`  __aiBlock.contexts.push(${captureVar});`, token.filename, line);
			buffer.writeStatement("} else {", token.filename, -1);
			buffer.writeStatement(
				`  state.__hypergenAddGlobalContext(${captureVar});`,
				token.filename,
				line,
			);
			buffer.writeStatement("}", token.filename, -1);
		},
	});
}

/**
 * @prompt — Block tag (inside @ai only).
 *
 * Captures rendered body into __aiBlock.prompt.
 */
function registerPromptTag(edge: Edge): void {
	edge.registerTag({
		tagName: "prompt",
		block: true,
		seekable: true,

		compile(parser, buffer, token) {
			const line = token.loc.start.line;

			const captureVar = `__promptBody_${line}`;
			const childBuffer = buffer.create(token.filename, {
				outputVar: captureVar,
			});

			for (const child of token.children) {
				parser.processToken(child, childBuffer);
			}

			buffer.writeStatement(
				childBuffer
					.disableFileAndLineVariables()
					.disableReturnStatement()
					.disableTryCatchBlock()
					.flush(),
				token.filename,
				line,
			);

			buffer.writeStatement(`if (typeof __aiBlock !== 'undefined') {`, token.filename, line);
			buffer.writeStatement(`  __aiBlock.prompt = ${captureVar};`, token.filename, line);
			buffer.writeStatement("}", token.filename, -1);
		},
	});
}

/**
 * @output — Block tag (inside @ai only).
 *
 * Takes optional { typeHint: 'jsx-fragment' } argument.
 * The body is a free-form description of the expected output format.
 * Use @example child tags inside @output to provide concrete examples.
 * Sets __aiBlock.outputDesc and __aiBlock.typeHint.
 */
function registerOutputTag(edge: Edge): void {
	edge.registerTag({
		tagName: "output",
		block: true,
		seekable: true,

		compile(parser, buffer, token) {
			const line = token.loc.start.line;
			const jsArg = token.properties.jsArg.trim();

			const captureVar = `__outputBody_${line}`;
			const childBuffer = buffer.create(token.filename, {
				outputVar: captureVar,
			});

			for (const child of token.children) {
				parser.processToken(child, childBuffer);
			}

			buffer.writeStatement(
				childBuffer
					.disableFileAndLineVariables()
					.disableReturnStatement()
					.disableTryCatchBlock()
					.flush(),
				token.filename,
				line,
			);

			buffer.writeStatement(`if (typeof __aiBlock !== 'undefined') {`, token.filename, line);

			if (jsArg) {
				buffer.writeStatement(`  let __oArgs_${line} = ${jsArg};`, token.filename, line);
				// Extract typeHint from argument object
				buffer.writeStatement(
					`  if (typeof __oArgs_${line} === 'object' && __oArgs_${line}.typeHint) { __aiBlock.typeHint = __oArgs_${line}.typeHint; }`,
					token.filename,
					line,
				);
			}

			buffer.writeStatement(`  __aiBlock.outputDesc = ${captureVar};`, token.filename, line);

			buffer.writeStatement("}", token.filename, -1);
		},
	});
}

/**
 * @example — Block tag (inside @ai only).
 *
 * Captures rendered body as a concrete example of expected output.
 * Multiple @example tags per @ai block are allowed — each is appended
 * to __aiBlock.examples[].
 *
 * The first example's body also serves as the default value for the key
 * variable during Pass 1, enabling downstream template code that references
 * the key to render during collection.
 */
function registerExampleTag(edge: Edge): void {
	edge.registerTag({
		tagName: "example",
		block: true,
		seekable: true,

		compile(parser, buffer, token) {
			const line = token.loc.start.line;

			const captureVar = `__exampleBody_${line}`;
			const childBuffer = buffer.create(token.filename, {
				outputVar: captureVar,
			});

			for (const child of token.children) {
				parser.processToken(child, childBuffer);
			}

			buffer.writeStatement(
				childBuffer
					.disableFileAndLineVariables()
					.disableReturnStatement()
					.disableTryCatchBlock()
					.flush(),
				token.filename,
				line,
			);

			buffer.writeStatement(`if (typeof __aiBlock !== 'undefined') {`, token.filename, line);
			buffer.writeStatement(`  __aiBlock.examples.push(${captureVar});`, token.filename, line);
			buffer.writeStatement("}", token.filename, -1);
		},
	});
}
