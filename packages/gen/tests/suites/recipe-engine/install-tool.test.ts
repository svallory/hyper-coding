/**
 * InstallTool Tests
 *
 * Tests for the install tool that manages package installation
 * via auto-detected or overridden package managers.
 *
 * NOTE: node:child_process cannot be mocked in bun's test runner (built-in module).
 * Dry-run mode is used extensively to test command generation without side effects.
 * Real execution tests use guaranteed-to-fail package names to verify error handling.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	InstallTool,
	InstallToolFactory,
	installToolFactory,
} from "#/recipe-engine/tools/install-tool";
import type { InstallExecutionResult, InstallStep, StepContext } from "#/recipe-engine/types";

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
 * Create an InstallStep for testing
 */
function createStep(overrides: Partial<InstallStep> = {}): InstallStep {
	return {
		name: "install-packages",
		tool: "install",
		packages: ["zod"],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InstallTool", () => {
	let testDir: string;
	let tool: InstallTool;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "hypergen-install-test-"));
		tool = new InstallTool();
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------------
	// Constructor and metadata
	// ---------------------------------------------------------------------------

	describe("constructor", () => {
		it("should create an instance with default name", () => {
			const t = new InstallTool();
			expect(t.getName()).toBe("install-tool");
			expect(t.getToolType()).toBe("install");
		});

		it("should accept a custom name", () => {
			const t = new InstallTool("my-installer");
			expect(t.getName()).toBe("my-installer");
		});

		it("should accept custom options", () => {
			const t = new InstallTool("custom", { verbose: true });
			expect(t.getToolType()).toBe("install");
		});
	});

	// ---------------------------------------------------------------------------
	// Validation
	// ---------------------------------------------------------------------------

	describe("validate", () => {
		it("should fail when packages array is missing", async () => {
			const step = createStep({ packages: undefined as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain("At least one package is required");
		});

		it("should fail when packages is not an array", async () => {
			const step = createStep({ packages: "zod" as any });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain("At least one package is required");
		});

		it("should fail when packages array is empty", async () => {
			const step = createStep({ packages: [] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain("At least one package is required");
		});

		it("should fail when a package name is an empty string", async () => {
			const step = createStep({ packages: ["zod", ""] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("Invalid package name"))).toBe(true);
		});

		it("should fail when a package name is whitespace only", async () => {
			const step = createStep({ packages: ["  "] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("Invalid package name"))).toBe(true);
		});

		it("should fail when a package is not a string", async () => {
			const step = createStep({ packages: [123 as any] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("Invalid package name"))).toBe(true);
		});

		it("should fail when a package is null", async () => {
			const step = createStep({ packages: [null as any] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.includes("Invalid package name"))).toBe(true);
		});

		it("should pass with a single valid package", async () => {
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should pass with multiple valid packages", async () => {
			const step = createStep({ packages: ["zod", "react", "@types/node"] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should pass with scoped packages", async () => {
			const step = createStep({
				packages: ["@tanstack/react-query", "@types/react"],
			});
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should pass with versioned packages", async () => {
			const step = createStep({ packages: ["zod@3.22.0", "react@^18.0.0"] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("should report estimated execution time", async () => {
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.estimatedExecutionTime).toBe(10000);
		});

		it("should report resource requirements", async () => {
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.resourceRequirements).toBeDefined();
			expect(result.resourceRequirements?.network).toBe(true);
			expect(result.resourceRequirements?.processes).toBe(1);
			expect(result.resourceRequirements?.memory).toBeGreaterThan(0);
			expect(result.resourceRequirements?.disk).toBeGreaterThan(0);
		});

		it("should collect multiple validation errors at once", async () => {
			const step = createStep({ packages: [null as any, "", 42 as any] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.isValid).toBe(false);
			// Should have errors for null, empty string, and number
			expect(result.errors.length).toBe(3);
		});

		it("should have empty warnings and suggestions on valid input", async () => {
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.validate(step, context);

			expect(result.warnings).toHaveLength(0);
			expect(result.suggestions).toHaveLength(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Package manager detection from lockfiles
	// ---------------------------------------------------------------------------

	describe("package manager detection", () => {
		it("should detect bun from bun.lockb", async () => {
			writeFileSync(join(testDir, "bun.lockb"), "");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("bun");
			expect(toolResult.command).toMatch(/^bun add/);
		});

		it("should detect bun from bun.lock", async () => {
			writeFileSync(join(testDir, "bun.lock"), "");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("bun");
			expect(toolResult.command).toMatch(/^bun add/);
		});

		it("should detect pnpm from pnpm-lock.yaml", async () => {
			writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("pnpm");
			expect(toolResult.command).toMatch(/^pnpm add/);
		});

		it("should detect yarn from yarn.lock", async () => {
			writeFileSync(join(testDir, "yarn.lock"), "");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("yarn");
			expect(toolResult.command).toMatch(/^yarn add/);
		});

		it("should detect npm from package-lock.json", async () => {
			writeFileSync(join(testDir, "package-lock.json"), "{}");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("npm");
			expect(toolResult.command).toMatch(/^npm install/);
		});

		it("should default to npm when no lockfile is found", async () => {
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("npm");
			expect(toolResult.command).toMatch(/^npm install/);
		});

		it("should prefer bun.lockb over other lockfiles when multiple exist", async () => {
			writeFileSync(join(testDir, "bun.lockb"), "");
			writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
			writeFileSync(join(testDir, "yarn.lock"), "");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("bun");
		});

		it("should prefer pnpm over yarn and npm when bun is absent", async () => {
			writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
			writeFileSync(join(testDir, "yarn.lock"), "");
			writeFileSync(join(testDir, "package-lock.json"), "{}");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("pnpm");
		});

		it("should prefer yarn over npm when bun and pnpm are absent", async () => {
			writeFileSync(join(testDir, "yarn.lock"), "");
			writeFileSync(join(testDir, "package-lock.json"), "{}");
			const step = createStep({ packages: ["zod"] });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("yarn");
		});
	});

	// ---------------------------------------------------------------------------
	// Package manager override
	// ---------------------------------------------------------------------------

	describe("package manager override", () => {
		it("should use step.packageManager over auto-detection", async () => {
			writeFileSync(join(testDir, "bun.lockb"), "");
			const step = createStep({ packages: ["zod"], packageManager: "pnpm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("pnpm");
			expect(toolResult.command).toMatch(/^pnpm add/);
		});

		it("should use yarn when overridden", async () => {
			const step = createStep({ packages: ["react"], packageManager: "yarn" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("yarn");
			expect(toolResult.command).toMatch(/^yarn add/);
		});

		it("should use npm when overridden despite bun lockfile present", async () => {
			writeFileSync(join(testDir, "bun.lockb"), "");
			const step = createStep({ packages: ["react"], packageManager: "npm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("npm");
			expect(toolResult.command).toMatch(/^npm install/);
		});

		it("should use bun when overridden despite npm lockfile present", async () => {
			writeFileSync(join(testDir, "package-lock.json"), "{}");
			const step = createStep({ packages: ["react"], packageManager: "bun" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packageManager).toBe("bun");
			expect(toolResult.command).toMatch(/^bun add/);
		});
	});

	// ---------------------------------------------------------------------------
	// Command format per package manager
	// ---------------------------------------------------------------------------

	describe("command format", () => {
		it("should format bun add command correctly", async () => {
			const step = createStep({
				packages: ["zod", "react"],
				packageManager: "bun",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("bun add zod react");
		});

		it("should format pnpm add command correctly", async () => {
			const step = createStep({
				packages: ["zod", "react"],
				packageManager: "pnpm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("pnpm add zod react");
		});

		it("should format yarn add command correctly", async () => {
			const step = createStep({
				packages: ["zod", "react"],
				packageManager: "yarn",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("yarn add zod react");
		});

		it("should format npm install command correctly", async () => {
			const step = createStep({
				packages: ["zod", "react"],
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("npm install zod react");
		});

		it("should handle scoped packages in commands", async () => {
			const step = createStep({
				packages: ["@tanstack/react-query", "@types/node"],
				packageManager: "bun",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("bun add @tanstack/react-query @types/node");
		});

		it("should handle a single package", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "npm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("npm install zod");
		});
	});

	// ---------------------------------------------------------------------------
	// Dev dependency flag
	// ---------------------------------------------------------------------------

	describe("dev dependency flag", () => {
		it("should add --dev for bun when dev: true", async () => {
			const step = createStep({
				packages: ["vitest"],
				dev: true,
				packageManager: "bun",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("bun add --dev vitest");
			expect(toolResult.dev).toBe(true);
		});

		it("should add --save-dev for pnpm when dev: true", async () => {
			const step = createStep({
				packages: ["vitest"],
				dev: true,
				packageManager: "pnpm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("pnpm add --save-dev vitest");
			expect(toolResult.dev).toBe(true);
		});

		it("should add --dev for yarn when dev: true", async () => {
			const step = createStep({
				packages: ["vitest"],
				dev: true,
				packageManager: "yarn",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("yarn add --dev vitest");
			expect(toolResult.dev).toBe(true);
		});

		it("should add --save-dev for npm when dev: true", async () => {
			const step = createStep({
				packages: ["vitest"],
				dev: true,
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("npm install --save-dev vitest");
			expect(toolResult.dev).toBe(true);
		});

		it("should not add dev flag when dev is false", async () => {
			const step = createStep({
				packages: ["zod"],
				dev: false,
				packageManager: "bun",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("bun add zod");
			expect(toolResult.dev).toBe(false);
		});

		it("should not add dev flag when dev is omitted", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "npm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("npm install zod");
			expect(toolResult.dev).toBe(false);
		});

		it("should combine dev flag with multiple packages", async () => {
			const step = createStep({
				packages: ["vitest", "@types/node", "prettier"],
				dev: true,
				packageManager: "bun",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("bun add --dev vitest @types/node prettier");
		});
	});

	// ---------------------------------------------------------------------------
	// Dry run mode
	// ---------------------------------------------------------------------------

	describe("dry run mode", () => {
		it("should return completed status via options.dryRun", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "npm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			expect(result.status).toBe("completed");
			expect(result.toolType).toBe("install");
			expect(result.stepName).toBe("install-packages");
		});

		it("should include dryRun flag and command in toolResult", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "npm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.dryRun).toBe(true);
			expect(toolResult.command).toBe("npm install zod");
			expect(toolResult.packages).toEqual(["zod"]);
			expect(toolResult.packageManager).toBe("npm");
		});

		it("should return command without executing when context.dryRun is true", async () => {
			const step = createStep({ packages: ["react"], packageManager: "yarn" });
			const context = createContext(testDir, { dryRun: true });

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.dryRun).toBe(true);
			expect(toolResult.command).toBe("yarn add react");
		});

		it("should include timing information in dry run result", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "bun" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});

		it("should include retryCount and dependenciesSatisfied in dry run", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "bun" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			expect(result.retryCount).toBe(0);
			expect(result.dependenciesSatisfied).toBe(true);
		});

		it("should include output with command and dryRun flag", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "pnpm" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			expect(result.output).toEqual({ command: "pnpm add zod", dryRun: true });
		});

		it("should include dev flag in dry run toolResult", async () => {
			const step = createStep({
				packages: ["vitest"],
				dev: true,
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.dev).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Real execution: failure path (uses nonexistent package to trigger error)
	// ---------------------------------------------------------------------------

	describe("real execution: failure handling", () => {
		// Use a package name that definitely doesn't exist on npm to trigger a real error
		const NONEXISTENT_PKG = "@hypergen-test-zzzz/does-not-exist-xyz-99999";

		it("should return failed status when install fails", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error?.code).toBe("INSTALL_FAILED");
			expect(result.error?.message).toBeTruthy();
		}, 30000);

		it("should include timing on failure", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.startTime).toBeInstanceOf(Date);
			expect(result.endTime).toBeInstanceOf(Date);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		}, 30000);

		it("should include error cause on failure", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.error).toBeDefined();
			expect(result.error?.cause).toBeDefined();
		}, 30000);
	});

	// ---------------------------------------------------------------------------
	// Optional install (failure is non-fatal)
	// ---------------------------------------------------------------------------

	describe("optional install", () => {
		const NONEXISTENT_PKG = "@hypergen-test-zzzz/does-not-exist-xyz-99999";

		it("should return completed status when optional and install fails", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				optional: true,
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("completed");
			expect(result.error).toBeUndefined();
		}, 30000);

		it("should include a warning in toolResult when optional install fails", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				optional: true,
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.optional).toBe(true);
			expect(toolResult.warning).toContain("Install failed (optional)");
		}, 30000);

		it("should include output.warning when optional install fails", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				optional: true,
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.output).toBeDefined();
			expect(result.output?.warning).toBeTruthy();
		}, 30000);

		it("should include packages in optional failure toolResult", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG, "also-fake-pkg"],
				optional: true,
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.packages).toEqual([NONEXISTENT_PKG, "also-fake-pkg"]);
		}, 30000);

		it("should still return failed when not optional and install fails", async () => {
			const step = createStep({
				packages: [NONEXISTENT_PKG],
				packageManager: "npm",
				// optional not set
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context);

			expect(result.status).toBe("failed");
			expect(result.error).toBeDefined();
			expect(result.error?.code).toBe("INSTALL_FAILED");
		}, 30000);
	});

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle packages with version specifiers", async () => {
			const step = createStep({
				packages: ["zod@3.22.0", "react@^18.0.0", "typescript@~5.3.0"],
				packageManager: "bun",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("bun add zod@3.22.0 react@^18.0.0 typescript@~5.3.0");
		});

		it("should handle packages with tag specifiers", async () => {
			const step = createStep({
				packages: ["next@canary", "react@experimental"],
				packageManager: "pnpm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("pnpm add next@canary react@experimental");
		});

		it("should handle git URL packages", async () => {
			const step = createStep({
				packages: ["github:user/repo"],
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("npm install github:user/repo");
		});

		it("should set dev to false when not specified", async () => {
			const step = createStep({ packages: ["zod"], packageManager: "bun" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.dev).toBe(false);
		});

		it("should handle many packages at once", async () => {
			const packages = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
			const step = createStep({ packages, packageManager: "yarn" });
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("yarn add a b c d e f g h i j");
			expect(toolResult.packages).toEqual(packages);
		});

		it("should preserve package order in command", async () => {
			const step = createStep({
				packages: ["zod", "react", "@types/node", "typescript"],
				packageManager: "npm",
			});
			const context = createContext(testDir);

			const result = await tool.execute(step, context, { dryRun: true });

			const toolResult = result.toolResult as InstallExecutionResult;
			expect(toolResult.command).toBe("npm install zod react @types/node typescript");
		});
	});
});

// ---------------------------------------------------------------------------
// InstallToolFactory
// ---------------------------------------------------------------------------

describe("InstallToolFactory", () => {
	it("should create an InstallTool instance", () => {
		const factory = new InstallToolFactory();
		const tool = factory.create("my-tool");

		expect(tool).toBeInstanceOf(InstallTool);
		expect(tool.getName()).toBe("my-tool");
		expect(tool.getToolType()).toBe("install");
	});

	it("should create with default name", () => {
		const factory = new InstallToolFactory();
		const tool = factory.create();

		expect(tool.getName()).toBe("install-tool");
	});

	it("should pass options to the tool", () => {
		const factory = new InstallToolFactory();
		const tool = factory.create("test", { verbose: true });

		expect(tool).toBeInstanceOf(InstallTool);
	});

	it("should report correct tool type", () => {
		const factory = new InstallToolFactory();
		expect(factory.getToolType()).toBe("install");
	});

	it("should always validate config as valid", () => {
		const factory = new InstallToolFactory();
		const result = factory.validateConfig({});

		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.warnings).toHaveLength(0);
		expect(result.suggestions).toHaveLength(0);
	});

	it("should export a singleton factory instance", () => {
		expect(installToolFactory).toBeInstanceOf(InstallToolFactory);
		expect(installToolFactory.getToolType()).toBe("install");
	});
});
