/**
 * Cost Tracker
 *
 * Tracks token usage and estimated costs across AI steps within a recipe execution.
 * Enforces budget limits and provides end-of-run summaries.
 */

import createDebug from "debug";
import { ErrorHandler, ErrorCode } from "#/errors/hypergen-errors";
import type { AIBudgetConfig, AIModelPricing, AICostSummary } from "#/ai-config.js";

const debug = createDebug("hypergen:ai:cost-tracker");

/**
 * Default cost table for common models (USD per 1M tokens)
 */
const DEFAULT_COST_TABLE: Record<string, AIModelPricing> = {
	"claude-sonnet-4-5": { inputPer1M: 3, outputPer1M: 15 },
	"claude-haiku-3-5": { inputPer1M: 0.8, outputPer1M: 4 },
	"gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
	"gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

interface StepCostEntry {
	stepName: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	retryAttempts: number;
}

export class CostTracker {
	private steps: StepCostEntry[] = [];
	private totalInputTokens = 0;
	private totalOutputTokens = 0;
	private totalCostUsd = 0;
	private budgetWarningTriggered = false;
	private budgetLimitHit = false;

	constructor(
		private readonly budget?: AIBudgetConfig,
		private readonly costTable: Record<string, AIModelPricing> = {},
	) {
		// Merge user cost table with defaults
		this.costTable = { ...DEFAULT_COST_TABLE, ...costTable };
		debug("CostTracker initialized with budget: %o", budget);
	}

	/**
	 * Calculate cost for a given token usage
	 */
	calculateCost(model: string, inputTokens: number, outputTokens: number): number {
		const pricing = this.costTable[model];
		if (!pricing) {
			debug("No pricing found for model %s, cost will be 0", model);
			return 0;
		}
		return (
			(inputTokens * pricing.inputPer1M) / 1_000_000 +
			(outputTokens * pricing.outputPer1M) / 1_000_000
		);
	}

	/**
	 * Record token usage from an AI step
	 */
	record(
		stepName: string,
		model: string,
		inputTokens: number,
		outputTokens: number,
		retryAttempts: number = 0,
	): void {
		const costUsd = this.calculateCost(model, inputTokens, outputTokens);

		this.steps.push({
			stepName,
			model,
			inputTokens,
			outputTokens,
			costUsd,
			retryAttempts,
		});
		this.totalInputTokens += inputTokens;
		this.totalOutputTokens += outputTokens;
		this.totalCostUsd += costUsd;

		debug(
			'Recorded step "%s": %d in + %d out = $%.4f (total: $%.4f)',
			stepName,
			inputTokens,
			outputTokens,
			costUsd,
			this.totalCostUsd,
		);
	}

	/**
	 * Check if budget allows another AI call.
	 * Returns null if OK, or throws if hard limit exceeded.
	 * Logs warning if warn threshold crossed.
	 */
	checkBudget(): void {
		if (!this.budget) return;

		// Check token limit
		if (
			this.budget.maxTotalTokens &&
			this.totalInputTokens + this.totalOutputTokens >= this.budget.maxTotalTokens
		) {
			this.budgetLimitHit = true;
			throw ErrorHandler.createError(
				ErrorCode.AI_BUDGET_EXCEEDED,
				`Token budget exceeded: ${this.totalInputTokens + this.totalOutputTokens} tokens used, limit is ${this.budget.maxTotalTokens}`,
				{},
			);
		}

		// Check cost limit
		if (this.budget.maxTotalCostUsd && this.totalCostUsd >= this.budget.maxTotalCostUsd) {
			this.budgetLimitHit = true;
			throw ErrorHandler.createError(
				ErrorCode.AI_BUDGET_EXCEEDED,
				`Cost budget exceeded: $${this.totalCostUsd.toFixed(4)} spent, limit is $${this.budget.maxTotalCostUsd.toFixed(2)}`,
				{},
			);
		}

		// Check warning threshold
		if (
			this.budget.warnAtCostUsd &&
			this.totalCostUsd >= this.budget.warnAtCostUsd &&
			!this.budgetWarningTriggered
		) {
			this.budgetWarningTriggered = true;
			debug(
				"Budget warning: $%.4f spent (threshold: $%.2f)",
				this.totalCostUsd,
				this.budget.warnAtCostUsd,
			);
			console.warn(
				`[hypergen:ai] Budget warning: $${this.totalCostUsd.toFixed(4)} spent of $${this.budget.maxTotalCostUsd?.toFixed(2) ?? "?"} limit`,
			);
		}
	}

	/**
	 * Get cost summary for the entire execution
	 */
	getSummary(): AICostSummary {
		return {
			totalInputTokens: this.totalInputTokens,
			totalOutputTokens: this.totalOutputTokens,
			totalTokens: this.totalInputTokens + this.totalOutputTokens,
			totalCostUsd: this.totalCostUsd,
			stepCount: this.steps.length,
			steps: [...this.steps],
			budgetWarningTriggered: this.budgetWarningTriggered,
			budgetLimitHit: this.budgetLimitHit,
		};
	}

	/**
	 * Format a human-readable cost report
	 */
	formatReport(): string {
		const lines: string[] = ["AI Cost Summary:", ""];

		if (this.steps.length === 0) {
			lines.push("  No AI steps executed.");
			return lines.join("\n");
		}

		for (const step of this.steps) {
			lines.push(
				`  ${step.stepName} (${step.model}): ${step.inputTokens} in + ${step.outputTokens} out = $${step.costUsd.toFixed(4)}${step.retryAttempts > 0 ? ` (${step.retryAttempts} retries)` : ""}`,
			);
		}

		lines.push("");
		lines.push(
			`  Total: ${this.totalInputTokens} in + ${this.totalOutputTokens} out = $${this.totalCostUsd.toFixed(4)}`,
		);

		if (this.budgetWarningTriggered) {
			lines.push(`  Warning: Budget warning threshold was triggered`);
		}
		if (this.budgetLimitHit) {
			lines.push(`  Error: Budget limit was exceeded`);
		}

		return lines.join("\n");
	}
}
