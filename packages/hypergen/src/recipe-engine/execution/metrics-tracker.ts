import type {
	RecipeStepUnion,
	StepExecutionMetrics,
	StepExecutionProgress,
	StepExecutorConfig,
} from './step-executor-types.js';

export class MetricsTracker {
	private readonly config: StepExecutorConfig;
	private metrics?: StepExecutionMetrics;
	private progress?: StepExecutionProgress;

	constructor(config: StepExecutorConfig) {
		this.config = config;
	}

	initializeMetrics(): void {
		this.metrics = {
			totalExecutionTime: 0,
			stepExecutionTimes: new Map(),
			memoryUsage: {
				peak: 0,
				average: 0,
				start: process.memoryUsage().heapUsed,
				end: 0,
			},
			parallelization: {
				maxConcurrentSteps: 0,
				averageConcurrentSteps: 0,
				parallelPhases: 0,
			},
			errors: {
				totalFailures: 0,
				totalRetries: 0,
				permanentFailures: [],
				recoveredAfterRetries: [],
			},
			dependencies: {
				resolutionTime: 0,
				cyclesDetected: 0,
				maxDepth: 0,
			},
		};
	}

	initializeProgress(totalSteps: number): void {
		this.progress = {
			currentPhase: 0,
			totalPhases: 0,
			runningSteps: [],
			completedSteps: [],
			failedSteps: [],
			skippedSteps: [],
			progressPercentage: 0,
			phaseDescription: 'Initializing...',
		};
	}

	updateProgressPercentage(): void {
		if (!this.progress) return;

		const totalSteps =
			this.progress.completedSteps.length +
			this.progress.failedSteps.length +
			this.progress.skippedSteps.length +
			this.progress.runningSteps.length;

		if (totalSteps === 0) return;

		const completed =
			this.progress.completedSteps.length +
			this.progress.failedSteps.length +
			this.progress.skippedSteps.length;

		this.progress.progressPercentage = Math.round(
			(completed / totalSteps) * 100,
		);
	}

	finalizeMetrics(): void {
		if (!this.metrics) return;

		this.metrics.memoryUsage.end = process.memoryUsage().heapUsed;

		// Calculate average memory usage (simplified)
		this.metrics.memoryUsage.average =
			(this.metrics.memoryUsage.start + this.metrics.memoryUsage.end) / 2;

		// Set peak to end for now (would need continuous monitoring for accuracy)
		this.metrics.memoryUsage.peak = Math.max(
			this.metrics.memoryUsage.start,
			this.metrics.memoryUsage.end,
		);
	}

	getMetrics(): StepExecutionMetrics | undefined {
		return this.metrics;
	}

	getProgress(): StepExecutionProgress | undefined {
		return this.progress;
	}

	// Expose metrics and progress for external updates (e.g., from StepExecutor)
	get currentMetrics(): StepExecutionMetrics | undefined {
		return this.metrics;
	}

	get currentProgress(): StepExecutionProgress | undefined {
		return this.progress;
	}

	set currentMetrics(metrics: StepExecutionMetrics | undefined) {
		this.metrics = metrics;
	}

	set currentProgress(progress: StepExecutionProgress | undefined) {
		this.progress = progress;
	}
}
