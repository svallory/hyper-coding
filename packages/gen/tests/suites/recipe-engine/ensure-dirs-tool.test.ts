import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EnsureDirsTool,
	EnsureDirsToolFactory,
	ensureDirsToolFactory,
} from "#/recipe-engine/tools/ensure-dirs-tool";
import type { EnsureDirsStep, StepContext, StepResult } from "#/recipe-engine/types";
import type { ToolValidationResult } from "#/recipe-engine/tools/base";

/**
 * Build a minimal StepContext with the required fields.
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
 * Build an EnsureDirsStep with sensible defaults.
 */
function createStep(paths: string[], overrides: Partial<EnsureDirsStep> = {}): EnsureDirsStep {
	return {
		tool: "ensure-dirs",
		name: "test-ensure-dirs",
		paths,
		...overrides,
	};
}

describe("EnsureDirsTool", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "ensure-dirs-test-"));
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------------------
	// 1. Constructor
	// ---------------------------------------------------------------------------
	describe("Constructor", () => {
		it("should create tool with default name", () => {
			const tool = new EnsureDirsTool();
			expect(tool.name).toBe("ensure-dirs-tool");
		});

		it("should create tool with custom name", () => {
			const tool = new EnsureDirsTool("my-dirs");
			expect(tool.name).toBe("my-dirs");
		});

		it("should have correct toolType property", () => {
			const tool = new EnsureDirsTool();
			expect(tool.toolType).toBe("ensure-dirs");
		});

		it("should have correct getToolType() result", () => {
			const tool = new EnsureDirsTool();
			expect(tool.getToolType()).toBe("ensure-dirs");
		});

		it("should accept options as second argument", () => {
			// options are opaque; just ensure construction succeeds
			const tool = new EnsureDirsTool("custom", { someOption: true });
			expect(tool.name).toBe("custom");
			expect(tool.toolType).toBe("ensure-dirs");
		});
	});

	// ---------------------------------------------------------------------------
	// 2. Creating directories
	// ---------------------------------------------------------------------------
	describe("Directory Creation", () => {
		it("should create a single directory", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["newdir"]);
			const dirPath = join(testDir, "newdir");

			expect(existsSync(dirPath)).toBe(false);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(dirPath)).toBe(true);
			expect(statSync(dirPath).isDirectory()).toBe(true);
			expect(result.toolResult).toBeDefined();
			expect(result.toolResult!.created).toContain("newdir");
			expect(result.toolResult!.alreadyExisted).toHaveLength(0);
		});

		it("should create multiple directories", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["src", "lib", "tests"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "src"))).toBe(true);
			expect(existsSync(join(testDir, "lib"))).toBe(true);
			expect(existsSync(join(testDir, "tests"))).toBe(true);

			const toolResult = result.toolResult!;
			expect(toolResult.created).toContain("src");
			expect(toolResult.created).toContain("lib");
			expect(toolResult.created).toContain("tests");
			expect(toolResult.created).toHaveLength(3);
			expect(toolResult.alreadyExisted).toHaveLength(0);
		});

		it("should create nested directories (mkdir -p behaviour)", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["src/components/forms", "lib/utils/helpers"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "src"))).toBe(true);
			expect(existsSync(join(testDir, "src/components"))).toBe(true);
			expect(existsSync(join(testDir, "src/components/forms"))).toBe(true);
			expect(existsSync(join(testDir, "lib/utils/helpers"))).toBe(true);

			const toolResult = result.toolResult!;
			expect(toolResult.created).toContain("src/components/forms");
			expect(toolResult.created).toContain("lib/utils/helpers");
		});

		it("should handle absolute paths", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const absolutePath = join(testDir, "absolute-dir");
			const step = createStep([absolutePath]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(absolutePath)).toBe(true);
			expect(result.toolResult!.created).toContain(absolutePath);
		});
	});

	// ---------------------------------------------------------------------------
	// 3. Already-existing directories
	// ---------------------------------------------------------------------------
	describe("Already-Existing Directories", () => {
		it("should report already-existing directories", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			mkdirSync(join(testDir, "existing1"));
			mkdirSync(join(testDir, "existing2"));

			const step = createStep(["existing1", "existing2"]);
			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult!;
			expect(toolResult.created).toHaveLength(0);
			expect(toolResult.alreadyExisted).toContain("existing1");
			expect(toolResult.alreadyExisted).toContain("existing2");
			expect(toolResult.alreadyExisted).toHaveLength(2);
		});

		it("should handle mixed new and existing directories", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			mkdirSync(join(testDir, "existing"));

			const step = createStep(["existing", "newdir1", "newdir2"]);
			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult!;

			expect(toolResult.alreadyExisted).toContain("existing");
			expect(toolResult.alreadyExisted).toHaveLength(1);

			expect(toolResult.created).toContain("newdir1");
			expect(toolResult.created).toContain("newdir2");
			expect(toolResult.created).toHaveLength(2);

			expect(existsSync(join(testDir, "newdir1"))).toBe(true);
			expect(existsSync(join(testDir, "newdir2"))).toBe(true);
		});

		it("should correctly partition created and existing in output", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			mkdirSync(join(testDir, "existing1"));
			mkdirSync(join(testDir, "existing2"));

			const step = createStep(["existing1", "new1", "existing2", "new2"]);
			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult!;
			expect(toolResult.paths).toEqual(["existing1", "new1", "existing2", "new2"]);
			expect(toolResult.created.sort()).toEqual(["new1", "new2"]);
			expect(toolResult.alreadyExisted.sort()).toEqual(["existing1", "existing2"]);
		});
	});

	// ---------------------------------------------------------------------------
	// 4. Variable resolution
	// ---------------------------------------------------------------------------
	describe("Variable Resolution", () => {
		it("should resolve a single variable in a path", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, {
				variables: { name: "MyComponent" },
			});
			const step = createStep(["components/{{ name }}"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "components/MyComponent"))).toBe(true);
			expect(result.toolResult!.created).toContain("components/MyComponent");
		});

		it("should resolve multiple variables in multiple paths", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, {
				variables: { component: "Button", feature: "auth" },
			});
			const step = createStep([
				"src/{{ feature }}/components",
				"src/{{ feature }}/{{ component }}",
			]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "src/auth/components"))).toBe(true);
			expect(existsSync(join(testDir, "src/auth/Button"))).toBe(true);
			expect(result.toolResult!.created).toContain("src/auth/components");
			expect(result.toolResult!.created).toContain("src/auth/Button");
		});

		it("should resolve dot-path variables", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, {
				variables: {
					org: "acme",
					project: "web",
					module: "dashboard",
				},
			});
			const step = createStep(["{{ org }}/{{ project }}/{{ module }}/components"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "acme/web/dashboard/components"))).toBe(true);
			expect(result.toolResult!.created).toContain("acme/web/dashboard/components");
		});

		it("should leave unresolvable variables as-is", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, { variables: {} });
			const step = createStep(["{{ unknown }}/src"]);

			const result = await tool.execute(step, context);

			// The variable is not resolved; the regex replaces {{ unknown }} with
			// the raw capture group re-wrapped, which may alter internal whitespace.
			// Just verify the path was created and contains "unknown".
			expect(result.status).toBe("completed");
			expect(result.toolResult!.created).toHaveLength(1);
			expect(result.toolResult!.created[0]).toContain("unknown");
			expect(result.toolResult!.created[0]).toContain("/src");
		});
	});

	// ---------------------------------------------------------------------------
	// 5. Dry run
	// ---------------------------------------------------------------------------
	describe("Dry Run", () => {
		it("should not create directories when context.dryRun is true", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, { dryRun: true });
			const step = createStep(["src", "lib", "tests"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "src"))).toBe(false);
			expect(existsSync(join(testDir, "lib"))).toBe(false);
			expect(existsSync(join(testDir, "tests"))).toBe(false);

			const toolResult = result.toolResult!;
			expect(toolResult.created).toContain("src");
			expect(toolResult.created).toContain("lib");
			expect(toolResult.created).toContain("tests");
		});

		it("should not create directories when options.dryRun is true", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["src", "lib"]);

			const result = await tool.execute(step, context, { dryRun: true });

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "src"))).toBe(false);
			expect(existsSync(join(testDir, "lib"))).toBe(false);
			expect(result.toolResult!.created).toContain("src");
			expect(result.toolResult!.created).toContain("lib");
		});

		it("should report existing directories correctly in dry run", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, { dryRun: true });

			mkdirSync(join(testDir, "existing"));

			const step = createStep(["existing", "newdir"]);
			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.toolResult!.alreadyExisted).toContain("existing");
			expect(result.toolResult!.created).toContain("newdir");
			// newdir must NOT be created on disk
			expect(existsSync(join(testDir, "newdir"))).toBe(false);
		});

		it("should handle nested paths in dry run", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir, { dryRun: true });
			const step = createStep(["src/components/forms"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(existsSync(join(testDir, "src"))).toBe(false);
			expect(result.toolResult!.created).toContain("src/components/forms");
		});
	});

	// ---------------------------------------------------------------------------
	// 6. Validation (via tool.validate())
	// ---------------------------------------------------------------------------
	describe("Validation (via validate())", () => {
		it("should fail if paths field is missing", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = {
				tool: "ensure-dirs",
				name: "bad-step",
			} as unknown as EnsureDirsStep;

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(false);
			expect(validation.errors.length).toBeGreaterThan(0);
			expect(validation.errors.some((e: string) => /path/i.test(e))).toBe(true);
		});

		it("should fail if paths is not an array", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = {
				tool: "ensure-dirs",
				name: "bad",
				paths: "not-an-array",
			} as any;

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(false);
			expect(validation.errors.length).toBeGreaterThan(0);
		});

		it("should fail if paths is an empty array", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep([]);

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(false);
			expect(validation.errors.some((e: string) => /at least one/i.test(e))).toBe(true);
		});

		it("should fail if paths contains a non-string entry", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["valid", 123 as any, "another"]);

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(false);
			expect(validation.errors.some((e: string) => /index 1/i.test(e))).toBe(true);
		});

		it("should fail if paths contains an empty string entry", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["valid", "", "another"]);

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(false);
			expect(validation.errors.some((e: string) => /index 1/i.test(e))).toBe(true);
		});

		it("should report multiple invalid entries", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep([42 as any, "", null as any]);

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(false);
			// At least errors for index 0, 1, 2
			expect(validation.errors.length).toBeGreaterThanOrEqual(3);
		});

		it("should pass validation with a single valid path", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["src"]);

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(true);
			expect(validation.errors).toHaveLength(0);
		});

		it("should pass validation with multiple valid paths", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["src", "lib", "tests"]);

			const validation = await tool.validate(step, context);
			expect(validation.isValid).toBe(true);
			expect(validation.errors).toHaveLength(0);
		});
	});

	// ---------------------------------------------------------------------------
	// 7. Error handling -- execute() returns failed, does NOT throw
	// ---------------------------------------------------------------------------
	describe("Error Handling", () => {
		it("should treat an existing file path as alreadyExisted (existsSync is true for files)", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			// Create a file where a directory path is expected
			writeFileSync(join(testDir, "conflict"), "content");
			const step = createStep(["conflict"]);

			// existsSync returns true for files, so the tool puts it in alreadyExisted
			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.toolResult!.alreadyExisted).toContain("conflict");
			expect(result.toolResult!.created).toHaveLength(0);
		});

		it("should return failed when mkdir fails (e.g., nested path through a file)", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			// Create a file that blocks nested directory creation
			writeFileSync(join(testDir, "blocker"), "content");
			// Attempt to create a subdirectory inside the file path
			const step = createStep(["blocker/subdir"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.code).toBe("ENSURE_DIRS_FAILED");
		});

		it("should return completed with empty arrays when given an empty paths array via execute()", async () => {
			// execute() does NOT call validate(), so empty paths => for...of [] => no-op => completed
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep([]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.toolResult!.created).toHaveLength(0);
			expect(result.toolResult!.alreadyExisted).toHaveLength(0);
		});

		it("should return failed when paths is undefined (runtime crash caught)", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = {
				tool: "ensure-dirs",
				name: "bad",
			} as unknown as EnsureDirsStep;

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error!.code).toBe("ENSURE_DIRS_FAILED");
		});
	});

	// ---------------------------------------------------------------------------
	// 8. Output shape
	// ---------------------------------------------------------------------------
	describe("Output", () => {
		it("should include created and alreadyExisted in result.output", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["dir1", "dir2", "dir3"]);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.output).toBeDefined();
			expect(result.output!.created).toEqual(["dir1", "dir2", "dir3"]);
			expect(result.output!.alreadyExisted).toEqual([]);
		});

		it("should include full EnsureDirsExecutionResult in toolResult", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["dir1", "dir2", "dir3"]);

			const result = await tool.execute(step, context);

			expect(result.toolResult).toBeDefined();
			expect(result.toolResult!.paths).toEqual(["dir1", "dir2", "dir3"]);
			expect(result.toolResult!.created).toEqual(["dir1", "dir2", "dir3"]);
			expect(result.toolResult!.alreadyExisted).toEqual([]);
		});

		it("should include alreadyExisted paths in both output and toolResult", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			mkdirSync(join(testDir, "dir1"));
			mkdirSync(join(testDir, "dir2"));

			const step = createStep(["dir1", "dir2"]);
			const result = await tool.execute(step, context);

			expect(result.output!.created).toEqual([]);
			expect(result.output!.alreadyExisted).toEqual(["dir1", "dir2"]);

			expect(result.toolResult!.paths).toEqual(["dir1", "dir2"]);
			expect(result.toolResult!.created).toEqual([]);
			expect(result.toolResult!.alreadyExisted).toEqual(["dir1", "dir2"]);
		});

		it("should set standard StepResult fields", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);
			const step = createStep(["some-dir"], { name: "create-dirs" });

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.stepName).toBe("create-dirs");
			expect(result.toolType).toBe("ensure-dirs");
			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(typeof result.duration).toBe("number");
			expect(result.retryCount).toBe(0);
			expect(result.dependenciesSatisfied).toBe(true);
		});

		it("should set error fields on failure", async () => {
			const tool = new EnsureDirsTool();
			const context = createContext(testDir);

			// Create a file that blocks nested directory creation (ENOTDIR)
			writeFileSync(join(testDir, "blocker"), "x");
			const step = createStep(["blocker/subdir"], { name: "fail-step" });

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.stepName).toBe("fail-step");
			expect(result.toolType).toBe("ensure-dirs");
			expect(result.error).toBeDefined();
			expect(typeof result.error!.message).toBe("string");
			expect(result.error!.code).toBe("ENSURE_DIRS_FAILED");
		});
	});

	// ---------------------------------------------------------------------------
	// 9. Factory
	// ---------------------------------------------------------------------------
	describe("Factory", () => {
		it("should create a tool instance with default name", () => {
			const factory = new EnsureDirsToolFactory();
			const tool = factory.create();
			expect(tool).toBeInstanceOf(EnsureDirsTool);
			expect(tool.name).toBe("ensure-dirs-tool");
		});

		it("should create a tool with a custom name", () => {
			const factory = new EnsureDirsToolFactory();
			const tool = factory.create("my-ensure-dirs");
			expect(tool).toBeInstanceOf(EnsureDirsTool);
			expect(tool.name).toBe("my-ensure-dirs");
		});

		it("should create a tool with custom name and options", () => {
			const factory = new EnsureDirsToolFactory();
			const tool = factory.create("custom", { someKey: 42 });
			expect(tool).toBeInstanceOf(EnsureDirsTool);
			expect(tool.name).toBe("custom");
		});

		it("should return correct tool type", () => {
			const factory = new EnsureDirsToolFactory();
			expect(factory.getToolType()).toBe("ensure-dirs");
		});

		it("should return ToolValidationResult from validateConfig()", () => {
			const factory = new EnsureDirsToolFactory();
			const result: ToolValidationResult = factory.validateConfig({
				tool: "ensure-dirs",
				paths: ["src"],
			});

			// The default implementation always returns isValid: true
			expect(result.isValid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.warnings).toEqual([]);
			expect(result.suggestions).toEqual([]);
		});

		it("should export a singleton factory instance", () => {
			expect(ensureDirsToolFactory).toBeInstanceOf(EnsureDirsToolFactory);
			expect(ensureDirsToolFactory.getToolType()).toBe("ensure-dirs");
		});
	});
});
