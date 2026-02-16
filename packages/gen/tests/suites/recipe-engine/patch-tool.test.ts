/**
 * PatchTool Tests
 *
 * Tests for the patch tool that deep-merges structured data into existing files.
 * Supports JSON, YAML, and TOML formats with auto-detection and explicit format override.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchTool, PatchToolFactory, patchToolFactory } from "#recipe-engine/tools/patch-tool";
import type { PatchExecutionResult, PatchStep, StepContext } from "#recipe-engine/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal StepContext for testing
 */
function createContext(projectRoot: string, overrides: Partial<StepContext> = {}): StepContext {
	return {
		projectRoot,
		step: {} as any,
		recipe: { id: "test", name: "Test", startTime: new Date() },
		recipeVariables: {},
		variables: {},
		stepData: {},
		stepResults: new Map(),
		evaluateCondition: () => true,
		...overrides,
	};
}

/**
 * Create a PatchStep for testing
 */
function createStep(overrides: Partial<PatchStep> = {}): PatchStep {
	return {
		name: "patch-config",
		tool: "patch",
		file: "config.json",
		merge: { key: "value" },
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PatchTool", () => {
	let testDir: string;
	let tool: PatchTool;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "hypergen-patch-test-"));
		tool = new PatchTool();
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------------
	// Constructor and metadata
	// ---------------------------------------------------------------------------

	describe("constructor", () => {
		it("should create an instance with default name", () => {
			const t = new PatchTool();
			expect(t.getName()).toBe("patch-tool");
			expect(t.getToolType()).toBe("patch");
		});

		it("should accept a custom name", () => {
			const t = new PatchTool("my-patcher");
			expect(t.getName()).toBe("my-patcher");
		});

		it("should accept custom options", () => {
			const t = new PatchTool("custom", { verbose: true });
			expect(t.getToolType()).toBe("patch");
		});
	});

	// ---------------------------------------------------------------------------
	// Validation
	// ---------------------------------------------------------------------------

	describe("validate", () => {
		it("should fail when file is missing", async () => {
			const step = createStep({ file: undefined as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain("File path is required");
		});

		it("should fail when merge is missing", async () => {
			const step = createStep({ merge: undefined as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain('"merge" must be a non-null object');
		});

		it("should fail when merge is an array", async () => {
			const step = createStep({ merge: ["invalid"] as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain('"merge" must be a non-null object');
		});

		it("should fail when merge is null", async () => {
			const step = createStep({ merge: null as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain('"merge" must be a non-null object');
		});

		it("should fail when format cannot be detected", async () => {
			const step = createStep({ file: "config.txt", merge: { key: "value" } });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("Cannot detect format"))).toBe(true);
		});

		it("should fail when format is unsupported", async () => {
			const step = createStep({
				file: "config.json",
				format: "xml" as any,
				merge: { key: "value" },
			});
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("Unsupported format"))).toBe(true);
		});

		it("should pass with valid step", async () => {
			const step = createStep({ file: "config.json", merge: { key: "value" } });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should report estimated execution time", async () => {
			const step = createStep();
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.estimatedExecutionTime).toBe(200);
		});

		it("should report resource requirements", async () => {
			const step = createStep();
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.resourceRequirements).toBeDefined();
			expect(result.resourceRequirements?.network).toBe(false);
			expect(result.resourceRequirements?.processes).toBe(0);
			expect(result.resourceRequirements?.memory).toBeGreaterThan(0);
			expect(result.resourceRequirements?.disk).toBeGreaterThan(0);
		});

		it("should collect multiple validation errors at once", async () => {
			const step = createStep({ file: undefined as any, merge: null as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(2);
		});

		it("should have empty warnings and suggestions on valid input", async () => {
			const step = createStep();
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.warnings).toHaveLength(0);
			expect(result.suggestions).toHaveLength(0);
		});
	});

	// ---------------------------------------------------------------------------
	// JSON patching
	// ---------------------------------------------------------------------------

	describe("JSON patching", () => {
		it("should merge into existing JSON file", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value", keep: true }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue", added: 123 },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({
				existing: "value",
				keep: true,
				newKey: "newValue",
				added: 123,
			});
		});

		it("should perform deep merge preserving existing keys", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(
				configPath,
				JSON.stringify(
					{
						database: {
							host: "localhost",
							port: 5432,
							credentials: { user: "admin" },
						},
					},
					null,
					2,
				),
			);

			const step = createStep({
				file: "config.json",
				merge: {
					database: {
						port: 3306,
						credentials: { password: "secret" },
					},
				},
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({
				database: {
					host: "localhost",
					port: 3306,
					credentials: {
						user: "admin",
						password: "secret",
					},
				},
			});
		});

		it("should replace arrays not concatenate them", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(
				configPath,
				JSON.stringify({ tags: ["old", "existing"], other: "value" }, null, 2),
			);

			const step = createStep({
				file: "config.json",
				merge: { tags: ["new", "replaced"] },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.tags).toEqual(["new", "replaced"]);
			expect(content.other).toBe("value");
		});

		it("should create file when missing with createIfMissing default true", async () => {
			const step = createStep({
				file: "new-config.json",
				merge: { created: true, value: 42 },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult as PatchExecutionResult;
			expect(toolResult.created).toBe(true);

			const configPath = join(testDir, "new-config.json");
			expect(existsSync(configPath)).toBe(true);
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({ created: true, value: 42 });
		});

		it("should fail when file missing and createIfMissing is false", async () => {
			const step = createStep({
				file: "missing.json",
				merge: { key: "value" },
				createIfMissing: false,
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error?.code).toBe("PATCH_FAILED");
			expect(result.error?.message).toContain("File not found");
		});

		it("should respect indent option with 4 spaces", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ old: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { nested: { deep: { value: 123 } } },
				indent: 4,
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const raw = readFileSync(configPath, "utf-8");
			// Check that indentation uses 4 spaces
			expect(raw).toContain('    "nested"');
			expect(raw).toContain('        "deep"');
		});

		it("should resolve variables in merge values", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: {
					projectName: "{{ name }}",
					version: "{{ version }}",
					nested: {
						author: "{{ author }}",
					},
				},
			});
			const context = createContext(testDir, {
				variables: {
					name: "my-project",
					version: "1.0.0",
					author: "John Doe",
				},
			});

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.projectName).toBe("my-project");
			expect(content.version).toBe("1.0.0");
			expect(content.nested.author).toBe("John Doe");
		});
	});

	// ---------------------------------------------------------------------------
	// YAML patching
	// ---------------------------------------------------------------------------

	describe("YAML patching", () => {
		it("should merge into existing YAML file", async () => {
			const configPath = join(testDir, "config.yml");
			writeFileSync(configPath, "existing: value\nkeep: true\n");

			const step = createStep({
				file: "config.yml",
				merge: { newKey: "newValue", added: 123 },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const { parse } = await import("yaml");
			const content = parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({
				existing: "value",
				keep: true,
				newKey: "newValue",
				added: 123,
			});
		});

		it("should create YAML file when missing", async () => {
			const step = createStep({
				file: "new-config.yaml",
				merge: { created: true, value: 42 },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult as PatchExecutionResult;
			expect(toolResult.created).toBe(true);
			expect(toolResult.format).toBe("yaml");

			const configPath = join(testDir, "new-config.yaml");
			expect(existsSync(configPath)).toBe(true);
			const { parse } = await import("yaml");
			const content = parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({ created: true, value: 42 });
		});
	});

	// ---------------------------------------------------------------------------
	// Deep merge
	// ---------------------------------------------------------------------------

	describe("deep merge", () => {
		it("should merge nested objects correctly", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(
				configPath,
				JSON.stringify(
					{
						level1: {
							level2: {
								level3: {
									existing: "value",
									keep: true,
								},
							},
						},
					},
					null,
					2,
				),
			);

			const step = createStep({
				file: "config.json",
				merge: {
					level1: {
						level2: {
							level3: {
								added: "new",
							},
							newLevel2: "value",
						},
					},
				},
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.level1.level2.level3).toEqual({
				existing: "value",
				keep: true,
				added: "new",
			});
			expect(content.level1.level2.newLevel2).toBe("value");
		});

		it("should add top-level keys", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ a: 1 }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { b: 2, c: 3, d: { nested: true } },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({
				a: 1,
				b: 2,
				c: 3,
				d: { nested: true },
			});
		});

		it("should preserve existing values when not in merge", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(
				configPath,
				JSON.stringify(
					{
						keep1: "original",
						keep2: { nested: "value" },
						update: "old",
					},
					null,
					2,
				),
			);

			const step = createStep({
				file: "config.json",
				merge: { update: "new", added: "value" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.keep1).toBe("original");
			expect(content.keep2).toEqual({ nested: "value" });
			expect(content.update).toBe("new");
			expect(content.added).toBe("value");
		});
	});

	// ---------------------------------------------------------------------------
	// Dry run
	// ---------------------------------------------------------------------------

	describe("dry run", () => {
		it("should not modify file when dryRun is set on options", async () => {
			const configPath = join(testDir, "config.json");
			const original = { existing: "value" };
			writeFileSync(configPath, JSON.stringify(original, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual(original); // Unchanged
		});

		it("should not modify file when context.dryRun is set", async () => {
			const configPath = join(testDir, "config.json");
			const original = { existing: "value" };
			writeFileSync(configPath, JSON.stringify(original, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue" },
			});
			const context = createContext(testDir, { dryRun: true });

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual(original); // Unchanged
		});
	});

	// ---------------------------------------------------------------------------
	// File tracking
	// ---------------------------------------------------------------------------

	describe("file tracking", () => {
		it("should set filesModified for existing file", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.filesModified).toBeDefined();
			expect(result.filesModified).toHaveLength(1);
			expect(result.filesModified?.[0]).toBe(configPath);
			expect(result.filesCreated).toBeUndefined();
		});

		it("should set filesCreated for new file", async () => {
			const step = createStep({
				file: "new-config.json",
				merge: { created: true },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.filesCreated).toBeDefined();
			expect(result.filesCreated).toHaveLength(1);
			expect(result.filesCreated?.[0]).toBe(join(testDir, "new-config.json"));
			expect(result.filesModified).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// Parent directory creation
	// ---------------------------------------------------------------------------

	describe("parent directory creation", () => {
		it("should create parent directories when file path has nested dirs", async () => {
			const step = createStep({
				file: "nested/deep/path/config.json",
				merge: { created: true, value: 42 },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const configPath = join(testDir, "nested/deep/path/config.json");
			expect(existsSync(configPath)).toBe(true);
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({ created: true, value: 42 });
		});
	});

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle empty merge object", async () => {
			const configPath = join(testDir, "config.json");
			const original = { existing: "value" };
			writeFileSync(configPath, JSON.stringify(original, null, 2));

			const step = createStep({
				file: "config.json",
				merge: {},
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual(original);
		});

		it("should handle overwriting existing key with different type", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ key: { nested: "object" } }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { key: "now a string" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.key).toBe("now a string");
		});

		it("should handle explicit format override", async () => {
			const configPath = join(testDir, "config.data");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.data",
				format: "json",
				merge: { added: true },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult as PatchExecutionResult;
			expect(toolResult.format).toBe("json");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content).toEqual({ existing: "value", added: true });
		});

		it("should include timing information in result", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});

		it("should include retryCount and dependenciesSatisfied", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.retryCount).toBe(0);
			expect(result.dependenciesSatisfied).toBe(true);
		});

		it("should include output with file, created, and format", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { newKey: "newValue" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.output).toBeDefined();
			expect(result.output?.file).toBe("config.json");
			expect(result.output?.created).toBe(false);
			expect(result.output?.format).toBe("json");
		});

		it("should handle null values in merge", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { nullValue: null, undefinedValue: undefined },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.nullValue).toBeNull();
		});

		it("should handle boolean and number values in merge", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: {
					boolTrue: true,
					boolFalse: false,
					number: 42,
					float: 3.14,
					zero: 0,
				},
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.boolTrue).toBe(true);
			expect(content.boolFalse).toBe(false);
			expect(content.number).toBe(42);
			expect(content.float).toBe(3.14);
			expect(content.zero).toBe(0);
		});

		it("should handle nested variable resolution", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: {
					nested: {
						value: "{{ user.name }}",
						deep: {
							value: "{{ user.email }}",
						},
					},
				},
			});
			const context = createContext(testDir, {
				variables: {
					user: {
						name: "John Doe",
						email: "john@example.com",
					},
				},
			});

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(content.nested.value).toBe("John Doe");
			expect(content.nested.deep.value).toBe("john@example.com");
		});

		it("should leave unresolved variables as-is", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, JSON.stringify({ existing: "value" }, null, 2));

			const step = createStep({
				file: "config.json",
				merge: { value: "{{ unknown }}" },
			});
			const context = createContext(testDir, { variables: {} });

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const content = JSON.parse(readFileSync(configPath, "utf-8"));
			// Variable resolution trims whitespace, so {{unknown}} is expected
			expect(content.value).toBe("{{unknown}}");
		});
	});

	// ---------------------------------------------------------------------------
	// Error handling
	// ---------------------------------------------------------------------------

	describe("error handling", () => {
		it("should return failed status on invalid JSON in existing file", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, "invalid json {");

			const step = createStep({
				file: "config.json",
				merge: { key: "value" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error?.code).toBe("PATCH_FAILED");
		});

		it("should include error cause on failure", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, "invalid json {");

			const step = createStep({
				file: "config.json",
				merge: { key: "value" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.error).toBeDefined();
			expect(result.error?.cause).toBeDefined();
		});

		it("should include timing information on failure", async () => {
			const configPath = join(testDir, "config.json");
			writeFileSync(configPath, "invalid json {");

			const step = createStep({
				file: "config.json",
				merge: { key: "value" },
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});
	});
});

// ---------------------------------------------------------------------------
// PatchToolFactory
// ---------------------------------------------------------------------------

describe("PatchToolFactory", () => {
	it("should create a PatchTool instance", () => {
		const factory = new PatchToolFactory();
		const tool = factory.create("my-tool");

		expect(tool).toBeInstanceOf(PatchTool);
		expect(tool.getName()).toBe("my-tool");
		expect(tool.getToolType()).toBe("patch");
	});

	it("should create with default name", () => {
		const factory = new PatchToolFactory();
		const tool = factory.create();

		expect(tool.getName()).toBe("patch-tool");
	});

	it("should pass options to the tool", () => {
		const factory = new PatchToolFactory();
		const tool = factory.create("test", { verbose: true });

		expect(tool).toBeInstanceOf(PatchTool);
	});

	it("should report correct tool type", () => {
		const factory = new PatchToolFactory();
		expect(factory.getToolType()).toBe("patch");
	});

	it("should always validate config as valid", () => {
		const factory = new PatchToolFactory();
		const result = factory.validateConfig({});

		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
		expect(result.suggestions).toHaveLength(0);
	});

	it("should export a singleton factory instance", () => {
		expect(patchToolFactory).toBeInstanceOf(PatchToolFactory);
		expect(patchToolFactory.getToolType()).toBe("patch");
	});
});
