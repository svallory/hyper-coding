import { EventEmitter } from 'node:events';
import createDebug from 'debug';
import type { Tool } from '../tools/base.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { RecipeStepUnion, StepResult } from './step-executor-types.js';

const debug = createDebug('hypergen:v8:recipe:cancellation');

export class CancellationManager extends EventEmitter {
	private readonly debug: ReturnType<typeof createDebug>;
	private readonly activeExecutions: Map<string, Promise<StepResult[]>>;
	private readonly runningSteps: Map<
		string,
		{ step: RecipeStepUnion; startTime: Date; tool: Tool }
	>;
	private readonly toolRegistry: ToolRegistry;

	constructor(
		activeExecutions: Map<string, Promise<StepResult[]>>,
		runningSteps: Map<
			string,
			{ step: RecipeStepUnion; startTime: Date; tool: Tool }
		>,
		toolRegistry: ToolRegistry,
	) {
		super();
		this.debug = debug;
		this.activeExecutions = activeExecutions;
		this.runningSteps = runningSteps;
		this.toolRegistry = toolRegistry;
	}

	async cancelAllExecutions(): Promise<void> {
		this.debug('Cancelling all running executions');

		const promises: Promise<void>[] = [];

		for (const [executionId] of this.activeExecutions) {
			promises.push(this.cancelExecution(executionId));
		}

		await Promise.allSettled(promises);
	}

	async cancelExecution(executionId: string): Promise<void> {
		this.debug('Cancelling execution: %s', executionId);

		// Cancel all running steps for this execution
		for (const [stepName, stepInfo] of this.runningSteps) {
			if (stepName.startsWith(executionId)) {
				try {
					await stepInfo.tool.cleanup();
				} catch (error) {
					this.debug(
						'Error cleaning up step during cancellation: %s - %s',
						stepName,
						error instanceof Error ? error.message : String(error),
					);
				}
			}
		}

		this.emit('execution:cancelled', { executionId });
	}
}
