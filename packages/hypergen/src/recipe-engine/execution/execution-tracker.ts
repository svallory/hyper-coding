/**
 * Execution tracker for managing active recipe executions
 */

/**
 * Recipe execution state
 */
export interface RecipeExecution {
	id: string;
	recipeName: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	startTime: Date;
	endTime?: Date;
	currentStep?: string;
}

/**
 * Execution tracker interface
 */
export interface ExecutionTracker {
	start(executionId: string, execution: RecipeExecution): void;
	get(executionId: string): RecipeExecution | undefined;
	getAll(): RecipeExecution[];
	update(executionId: string, updates: Partial<RecipeExecution>): void;
	cancel(executionId: string): void;
	complete(executionId: string): void;
	clear(): void;
}

/**
 * Create an execution tracker instance
 */
export function createExecutionTracker(): ExecutionTracker {
	const executions = new Map<string, RecipeExecution>();

	return {
		start(executionId: string, execution: RecipeExecution): void {
			executions.set(executionId, execution);
		},

		get(executionId: string): RecipeExecution | undefined {
			return executions.get(executionId);
		},

		getAll(): RecipeExecution[] {
			return Array.from(executions.values());
		},

		update(executionId: string, updates: Partial<RecipeExecution>): void {
			const execution = executions.get(executionId);
			if (execution) {
				executions.set(executionId, { ...execution, ...updates });
			}
		},

		cancel(executionId: string): void {
			const execution = executions.get(executionId);
			if (execution) {
				executions.set(executionId, {
					...execution,
					status: 'cancelled',
					endTime: new Date(),
				});
			}
		},

		complete(executionId: string): void {
			executions.delete(executionId);
		},

		clear(): void {
			executions.clear();
		},
	};
}
