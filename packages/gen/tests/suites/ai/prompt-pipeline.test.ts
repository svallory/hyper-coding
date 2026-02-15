import { describe, it, expect, beforeEach } from "vitest";
import { PromptPipeline } from "#/ai/prompt-pipeline";
import type { StepResult } from "#/recipe-engine/types";
import path from "path";
import fs from "fs";
import os from "os";

describe("PromptPipeline", () => {
	let pipeline: PromptPipeline;
	let tmpDir: string;

	beforeEach(() => {
		pipeline = new PromptPipeline();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hypergen-test-"));
	});

	describe("assemble", () => {
		it("assembles basic prompt without context", async () => {
			const result = await pipeline.assemble({
				prompt: "Generate a hello world function",
				projectRoot: tmpDir,
				stepResults: new Map(),
			});

			expect(result.user).toContain("Generate a hello world function");
			expect(result.system).toBe("");
			expect(result.estimatedTokens).toBeGreaterThan(0);
		});

		it("includes system prompt from config", async () => {
			const result = await pipeline.assemble({
				globalSystemPrompt: "You are a TypeScript expert.",
				prompt: "Generate code",
				projectRoot: tmpDir,
				stepResults: new Map(),
			});

			expect(result.system).toContain("You are a TypeScript expert");
		});

		it("merges step and global system prompts", async () => {
			const result = await pipeline.assemble({
				globalSystemPrompt: "Global instructions.",
				stepSystemPrompt: "Step-specific instructions.",
				prompt: "Generate code",
				projectRoot: tmpDir,
				stepResults: new Map(),
			});

			expect(result.system).toContain("Global instructions");
			expect(result.system).toContain("Step-specific instructions");
		});

		it("includes context files", async () => {
			const testFile = path.join(tmpDir, "test.ts");
			fs.writeFileSync(testFile, 'export const hello = "world"');

			const result = await pipeline.assemble({
				prompt: "Use the test file",
				context: { include: ["test.ts"] },
				projectRoot: tmpDir,
				stepResults: new Map(),
			});

			expect(result.user).toContain("export const hello");
			expect(result.contextBundle.files.size).toBe(1);
		});

		it("includes few-shot examples", async () => {
			const result = await pipeline.assemble({
				prompt: "Generate similar code",
				examples: [
					{
						label: "Example 1",
						input: "Create a User class",
						output: "class User {}",
					},
				],
				projectRoot: tmpDir,
				stepResults: new Map(),
			});

			expect(result.user).toContain("Example 1");
			expect(result.user).toContain("Create a User class");
			expect(result.user).toContain("class User {}");
		});

		it("adds guardrail instructions to system prompt", async () => {
			const result = await pipeline.assemble({
				prompt: "Generate code",
				guardrails: {
					validateSyntax: "typescript",
					requireKnownImports: true,
					allowedImports: ["lodash", "zod"],
				},
				projectRoot: tmpDir,
				stepResults: new Map(),
			});

			expect(result.system).toContain("valid typescript syntax");
			expect(result.system).toContain("package.json");
			expect(result.system).toContain("lodash, zod");
		});

		it("includes previous step results", async () => {
			const stepResults = new Map<string, StepResult>();
			stepResults.set("scaffold", {
				status: "completed",
				stepName: "scaffold",
				toolType: "template",
				startTime: new Date(),
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: {
					templateName: "api-controller",
					templatePath: "/templates/api-controller.jig.t",
					engine: "liquid",
					filesGenerated: ["src/controllers/user.controller.ts"],
					variables: { name: "user" },
				},
			});

			const result = await pipeline.assemble({
				prompt: "Fill in method bodies",
				context: { fromSteps: ["scaffold"] },
				projectRoot: tmpDir,
				stepResults,
			});

			expect(result.user).toContain("scaffold");
			expect(result.contextBundle.stepOutputs.size).toBe(1);
		});
	});
});
