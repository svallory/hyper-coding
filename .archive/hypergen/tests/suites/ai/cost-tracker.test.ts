import { beforeEach, describe, expect, it } from "vitest";
import { CostTracker } from "#/ai/cost-tracker";

describe("CostTracker", () => {
	let tracker: CostTracker;

	beforeEach(() => {
		tracker = new CostTracker(
			{ maxTotalCostUsd: 1.0, warnAtCostUsd: 0.5, maxTotalTokens: 100000 },
			{ "test-model": { inputPer1M: 3, outputPer1M: 15 } },
		);
	});

	describe("calculateCost", () => {
		it("calculates cost correctly", () => {
			const cost = tracker.calculateCost("test-model", 1000, 500);
			// (1000 * 3 / 1_000_000) + (500 * 15 / 1_000_000) = 0.003 + 0.0075 = 0.0105
			expect(cost).toBeCloseTo(0.0105, 4);
		});

		it("returns 0 for unknown models", () => {
			const cost = tracker.calculateCost("unknown-model", 1000, 500);
			expect(cost).toBe(0);
		});
	});

	describe("record", () => {
		it("tracks token usage", () => {
			tracker.record("step1", "test-model", 1000, 500);
			const summary = tracker.getSummary();
			expect(summary.totalInputTokens).toBe(1000);
			expect(summary.totalOutputTokens).toBe(500);
			expect(summary.totalTokens).toBe(1500);
			expect(summary.stepCount).toBe(1);
		});

		it("accumulates across multiple steps", () => {
			tracker.record("step1", "test-model", 1000, 500);
			tracker.record("step2", "test-model", 2000, 1000);
			const summary = tracker.getSummary();
			expect(summary.totalInputTokens).toBe(3000);
			expect(summary.totalOutputTokens).toBe(1500);
			expect(summary.stepCount).toBe(2);
		});
	});

	describe("checkBudget", () => {
		it("does nothing when under budget", () => {
			tracker.record("step1", "test-model", 100, 50);
			expect(() => tracker.checkBudget()).not.toThrow();
		});

		it("throws when cost exceeds limit", () => {
			// Record enough to exceed $1.00 but stay under 100K token limit
			// 10K input * 3/1M = $0.03, 80K output * 15/1M = $1.20 → total $1.23
			tracker.record("step1", "test-model", 10000, 80000);
			expect(() => tracker.checkBudget()).toThrow("Cost budget exceeded");
		});

		it("throws when token limit exceeded", () => {
			tracker.record("step1", "test-model", 60000, 50000);
			expect(() => tracker.checkBudget()).toThrow("Token budget exceeded");
		});

		it("does not throw without budget config", () => {
			const noBudgetTracker = new CostTracker();
			noBudgetTracker.record("step1", "test-model", 999999, 999999);
			expect(() => noBudgetTracker.checkBudget()).not.toThrow();
		});
	});

	describe("getSummary", () => {
		it("returns complete summary", () => {
			tracker.record("step1", "test-model", 1000, 500, 1);
			const summary = tracker.getSummary();

			expect(summary.stepCount).toBe(1);
			expect(summary.steps).toHaveLength(1);
			expect(summary.steps[0].stepName).toBe("step1");
			expect(summary.steps[0].retryAttempts).toBe(1);
			expect(summary.budgetWarningTriggered).toBe(false);
			expect(summary.budgetLimitHit).toBe(false);
		});
	});

	describe("formatReport", () => {
		it("formats empty report", () => {
			const report = tracker.formatReport();
			expect(report).toContain("No AI steps executed");
		});

		it("formats report with steps", () => {
			tracker.record("step1", "test-model", 1000, 500);
			const report = tracker.formatReport();
			expect(report).toContain("step1");
			expect(report).toContain("test-model");
			expect(report).toContain("Total:");
		});
	});
});
