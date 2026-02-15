import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextCollector } from "#/ai/context-collector";
import type { StepResult } from "#/recipe-engine/types";

describe("ContextCollector", () => {
	let collector: ContextCollector;
	let tmpDir: string;

	beforeEach(() => {
		collector = new ContextCollector();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hypergen-ctx-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("collect", () => {
		it("returns empty bundle when config is undefined", async () => {
			const bundle = await collector.collect(undefined, tmpDir, new Map());
			expect(bundle.files.size).toBe(0);
			expect(bundle.configs.size).toBe(0);
			expect(bundle.stepOutputs.size).toBe(0);
		});

		it("collects explicit files", async () => {
			fs.writeFileSync(path.join(tmpDir, "test.ts"), "const x = 1");

			const bundle = await collector.collect({ include: ["test.ts"] }, tmpDir, new Map());

			expect(bundle.files.size).toBe(1);
			expect(bundle.files.get("test.ts")).toBe("const x = 1");
		});

		it("collects project config files", async () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}');
			fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), '{"compilerOptions":{}}');

			const bundle = await collector.collect(
				{ projectConfig: ["package.json", "tsconfig"] },
				tmpDir,
				new Map(),
			);

			expect(bundle.configs.size).toBe(2);
			expect(bundle.configs.get("package.json")).toContain("test");
			expect(bundle.configs.get("tsconfig")).toContain("compilerOptions");
		});

		it("collects with projectConfig: true", async () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}');

			const bundle = await collector.collect({ projectConfig: true }, tmpDir, new Map());

			expect(bundle.configs.has("package.json")).toBe(true);
		});

		it("collects previous step results", async () => {
			const stepResults = new Map<string, StepResult>();
			stepResults.set("step1", {
				status: "completed",
				stepName: "step1",
				toolType: "template",
				startTime: new Date(),
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: { data: "some output" },
			});

			const bundle = await collector.collect({ fromSteps: ["step1"] }, tmpDir, stepResults);

			expect(bundle.stepOutputs.size).toBe(1);
			expect(bundle.stepOutputs.get("step1")).toContain("some output");
		});

		it("respects maxContextTokens", async () => {
			// Write a large file
			fs.writeFileSync(path.join(tmpDir, "large.ts"), "x".repeat(10000));

			const bundle = await collector.collect(
				{ include: ["large.ts"], maxContextTokens: 100 },
				tmpDir,
				new Map(),
			);

			// Should be truncated or skipped (depends on overflow setting)
			expect(bundle.truncated).toBe(true);
		});

		it('truncates when overflow is "truncate"', async () => {
			fs.writeFileSync(path.join(tmpDir, "large.ts"), "x".repeat(10000));

			const bundle = await collector.collect(
				{ include: ["large.ts"], maxContextTokens: 500, overflow: "truncate" },
				tmpDir,
				new Map(),
			);

			expect(bundle.truncated).toBe(true);
			const content = bundle.files.get("large.ts");
			expect(content).toBeDefined();
			expect(content!).toContain("[truncated]");
		});

		it('throws when overflow is "error"', async () => {
			fs.writeFileSync(path.join(tmpDir, "large.ts"), "x".repeat(10000));

			await expect(
				collector.collect(
					{ include: ["large.ts"], maxContextTokens: 100, overflow: "error" },
					tmpDir,
					new Map(),
				),
			).rejects.toThrow("exceeds token budget");
		});

		it("skips missing files gracefully", async () => {
			const bundle = await collector.collect({ include: ["nonexistent.ts"] }, tmpDir, new Map());

			expect(bundle.files.size).toBe(0);
		});

		it("collects glob patterns", async () => {
			fs.writeFileSync(path.join(tmpDir, "a.ts"), "const a = 1");
			fs.writeFileSync(path.join(tmpDir, "b.ts"), "const b = 2");
			fs.writeFileSync(path.join(tmpDir, "c.js"), "const c = 3");

			const bundle = await collector.collect({ files: ["*.ts"] }, tmpDir, new Map());

			expect(bundle.files.size).toBe(2);
		});
	});
});
