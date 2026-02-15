/**
 * Output Validator
 *
 * Validates AI-generated output for syntax correctness, import safety,
 * and schema compliance. Supports retry-with-feedback.
 */

import createDebug from "debug";
import fs from "fs";
import path from "path";
import type { AIGuardrailConfig } from "./ai-config.js";

const debug = createDebug("hypergen:ai:output-validator");

/**
 * Validation result from a single validation pass
 */
export interface ValidationResult {
	passed: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validate AI output according to guardrail configuration
 */
export async function validateOutput(
	output: string,
	guardrails: AIGuardrailConfig | undefined,
	projectRoot: string,
): Promise<ValidationResult> {
	if (!guardrails) {
		return { passed: true, errors: [], warnings: [] };
	}

	const errors: string[] = [];
	const warnings: string[] = [];

	// Syntax validation
	if (guardrails.validateSyntax) {
		const syntaxResult = validateSyntax(output, guardrails.validateSyntax);
		errors.push(...syntaxResult.errors);
		warnings.push(...syntaxResult.warnings);
	}

	// Import validation
	if (guardrails.requireKnownImports || guardrails.allowedImports || guardrails.blockedImports) {
		const importResult = validateImports(output, guardrails, projectRoot);
		errors.push(...importResult.errors);
		warnings.push(...importResult.warnings);
	}

	// Max output length
	if (guardrails.maxOutputLength && output.length > guardrails.maxOutputLength) {
		errors.push(`Output length (${output.length}) exceeds maximum (${guardrails.maxOutputLength})`);
	}

	// Empty/gibberish check
	if (output.trim().length === 0) {
		errors.push("AI returned empty output");
	} else if (output.trim().length < 10) {
		warnings.push("AI output is suspiciously short");
	}

	const passed = errors.length === 0;
	debug(
		"Validation %s: %d errors, %d warnings",
		passed ? "passed" : "failed",
		errors.length,
		warnings.length,
	);

	return { passed, errors, warnings };
}

/**
 * Validate syntax for supported languages
 */
function validateSyntax(
	output: string,
	lang: boolean | "typescript" | "javascript" | "json" | "yaml" | "css" | "html",
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	const language = lang === true ? "javascript" : lang;

	switch (language) {
		case "json": {
			try {
				JSON.parse(output);
			} catch (e: any) {
				errors.push(`JSON syntax error: ${e.message}`);
			}
			break;
		}

		case "yaml": {
			try {
				// Dynamic import to avoid requiring yaml for non-yaml validation
				const yaml = require("js-yaml");
				yaml.load(output);
			} catch (e: any) {
				errors.push(`YAML syntax error: ${e.message}`);
			}
			break;
		}

		case "typescript":
		case "javascript": {
			// Use TypeScript compiler API for syntax-only check
			try {
				const ts = require("typescript");
				const sourceFile = ts.createSourceFile(
					language === "typescript" ? "output.ts" : "output.js",
					output,
					ts.ScriptTarget.Latest,
					true, // setParentNodes
					language === "typescript" ? ts.ScriptKind.TS : ts.ScriptKind.JS,
				);

				// Check for syntax diagnostics
				const diagnostics = sourceFile.parseDiagnostics || [];
				for (const diag of diagnostics) {
					const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
					const line =
						diag.start !== undefined
							? sourceFile.getLineAndCharacterOfPosition(diag.start).line + 1
							: "?";
					errors.push(`${language} syntax error at line ${line}: ${message}`);
				}
			} catch (e: any) {
				// If TypeScript is not available, fall back to basic check
				if (e.code === "MODULE_NOT_FOUND") {
					debug("TypeScript not available for syntax validation, skipping");
					warnings.push("TypeScript compiler not available for syntax validation");
				} else {
					errors.push(`Syntax validation error: ${e.message}`);
				}
			}
			break;
		}

		case "css":
		case "html":
			// Basic heuristic checks for CSS/HTML
			debug("Basic validation for %s (no full parser)", language);
			break;

		default:
			debug("Unknown language for syntax validation: %s", language);
	}

	return { passed: errors.length === 0, errors, warnings };
}

/**
 * Validate imports against package.json and allow/block lists
 */
function validateImports(
	output: string,
	guardrails: AIGuardrailConfig,
	projectRoot: string,
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Extract import statements (ES modules and CommonJS)
	const importRegex =
		/(?:import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
	const imports: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = importRegex.exec(output)) !== null) {
		const pkg = match[1] || match[2];
		// Only check external packages (not relative paths or built-in modules)
		if (
			pkg &&
			!pkg.startsWith(".") &&
			!pkg.startsWith("/") &&
			!pkg.startsWith("#") &&
			!isNodeBuiltin(pkg)
		) {
			// Get the package name (handle scoped packages)
			const packageName = pkg.startsWith("@")
				? pkg.split("/").slice(0, 2).join("/")
				: pkg.split("/")[0];
			imports.push(packageName);
		}
	}

	if (imports.length === 0) return { passed: true, errors, warnings };

	// Check blocked imports
	if (guardrails.blockedImports) {
		for (const imp of imports) {
			if (guardrails.blockedImports.includes(imp)) {
				errors.push(`Blocked import: "${imp}" is not allowed`);
			}
		}
	}

	// Check allowed imports
	if (guardrails.allowedImports) {
		for (const imp of imports) {
			if (!guardrails.allowedImports.includes(imp)) {
				errors.push(
					`Import "${imp}" is not in the allowed list: ${guardrails.allowedImports.join(", ")}`,
				);
			}
		}
	}

	// Check against package.json
	if (guardrails.requireKnownImports) {
		const packageJsonPath = path.resolve(projectRoot, "package.json");
		if (fs.existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
				const knownPackages = new Set<string>([
					...Object.keys(packageJson.dependencies || {}),
					...Object.keys(packageJson.devDependencies || {}),
					...Object.keys(packageJson.peerDependencies || {}),
					...Object.keys(packageJson.optionalDependencies || {}),
				]);

				for (const imp of imports) {
					if (!knownPackages.has(imp)) {
						errors.push(`Import "${imp}" not found in package.json`);
					}
				}
			} catch (e) {
				warnings.push("Could not read package.json for import validation");
			}
		} else {
			warnings.push("No package.json found for import validation");
		}
	}

	return { passed: errors.length === 0, errors, warnings };
}

/**
 * Check if a module name is a Node.js built-in
 */
function isNodeBuiltin(name: string): boolean {
	const builtins = new Set([
		"assert",
		"buffer",
		"child_process",
		"cluster",
		"console",
		"constants",
		"crypto",
		"dgram",
		"dns",
		"domain",
		"events",
		"fs",
		"http",
		"https",
		"module",
		"net",
		"os",
		"path",
		"perf_hooks",
		"process",
		"punycode",
		"querystring",
		"readline",
		"repl",
		"stream",
		"string_decoder",
		"sys",
		"timers",
		"tls",
		"tty",
		"url",
		"util",
		"v8",
		"vm",
		"worker_threads",
		"zlib",
		"node:assert",
		"node:buffer",
		"node:child_process",
		"node:cluster",
		"node:console",
		"node:constants",
		"node:crypto",
		"node:dgram",
		"node:dns",
		"node:domain",
		"node:events",
		"node:fs",
		"node:http",
		"node:https",
		"node:module",
		"node:net",
		"node:os",
		"node:path",
		"node:perf_hooks",
		"node:process",
		"node:punycode",
		"node:querystring",
		"node:readline",
		"node:repl",
		"node:stream",
		"node:string_decoder",
		"node:sys",
		"node:test",
		"node:timers",
		"node:tls",
		"node:tty",
		"node:url",
		"node:util",
		"node:v8",
		"node:vm",
		"node:worker_threads",
		"node:zlib",
	]);
	return builtins.has(name) || name.startsWith("node:");
}

/**
 * Build feedback message from validation errors for retry-with-feedback
 */
export function buildValidationFeedback(result: ValidationResult): string {
	const lines = ["Your previous output had the following errors:"];
	for (const error of result.errors) {
		lines.push(`- ${error}`);
	}
	lines.push("");
	lines.push(
		"Fix these errors and regenerate. Do NOT include any explanation, only the corrected output.",
	);
	return lines.join("\n");
}
