import type {
	ActionStep,
	CodeModStep,
	RecipeStep as RecipeStepType,
	TemplateStep,
	ToolType,
} from '../types.js';

// Re-export ToolType for convenience
export type { ToolType };

// Re-export step types
export type { TemplateStep, ActionStep, CodeModStep, RecipeStepType };

// Interfaces for Step Execution
export interface StepExecutionMetrics {
	totalExecutionTime: number;
	stepExecutionTimes: Map<string, number>;
	memoryUsage: {
		peak: number;
		average: number;
		start: number;
		end: number;
	};
	parallelization: {
		maxConcurrentSteps: number;
		averageConcurrentSteps: number;
		parallelPhases: number;
	};
	errors: {
		totalFailures: number;
		totalRetries: number;
		permanentFailures: string[];
		recoveredAfterRetries: string[];
	};
	dependencies: {
		resolutionTime: number;
		cyclesDetected: number;
		maxDepth: number;
	};
}

export interface StepExecutionProgress {
	currentPhase: number;
	totalPhases: number;
	runningSteps: string[];
	completedSteps: string[];
	failedSteps: string[];
	skippedSteps: string[];
	progressPercentage: number;
	phaseDescription: string;
	estimatedRemainingTime?: number;
}

export interface StepExecutorConfig {
	maxConcurrency: number;
	defaultTimeout: number;
	defaultRetries: number;
	continueOnError: boolean;
	enableParallelExecution: boolean;
	collectMetrics: boolean;
	enableProgressTracking: boolean;
	memoryWarningThreshold: number;
	timeoutSafetyFactor: number;
}

// Recipe Step Types (inferred from usage)
export interface RecipeStep {
	name: string;
	tool: ToolType;
	when?: string;
	dependsOn?: string[];
	retries?: number;
	parallel?: boolean;
}

// RecipeStepUnion is a union of all step types
export type RecipeStepUnion =
	| TemplateStep
	| ActionStep
	| CodeModStep
	| RecipeStepType;

export interface StepContext {
	step: RecipeStepUnion;
	variables: Record<string, any>;
	projectRoot: string;
	recipeVariables: Record<string, any>;
	stepResults: Map<string, StepResult>;
	recipe: {
		id: string;
		name: string;
		version: string;
		startTime: Date;
	};
	stepData: Record<string, any>;
	evaluateCondition: (
		condition: string,
		variables: Record<string, any>,
	) => boolean;
	dryRun?: boolean;
	force?: boolean;
	logger: any;
}

export interface StepDependencyNode {
	stepName: string;
	dependencies: string[];
	dependents: string[];
	priority: number;
	parallelizable: boolean;
}

export interface RecipeExecutionPlan {
	recipe: {
		name: string;
		description: string;
		version: string;
		author?: string;
		category?: string;
		tags: string[];
		variables: Record<string, any>;
		steps: RecipeStepUnion[];
		examples: any[];
		dependencies: any[];
		outputs: any[];
	};
	phases: Array<{
		phase: number;
		steps: string[];
		parallel: boolean;
	}>;
	dependencyGraph: Map<string, StepDependencyNode>;
	estimatedDuration: number;
}

export interface StepExecutionOptions {
	retries?: number;
	continueOnError?: boolean;
}

export type StepStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'skipped';

export interface StepResult {
	status: StepStatus;
	stepName: string;
	toolType: ToolType;
	startTime: Date;
	endTime?: Date;
	duration?: number;
	retryCount: number;
	dependenciesSatisfied: boolean;
	conditionResult: boolean;
	toolResult?: any;
	error?: {
		message: string;
		stack?: string;
		cause?: any;
	};
	filesCreated?: string[];
	filesModified?: string[];
	filesDeleted?: string[];
}

// Error Classes
export class CircularDependencyError extends Error {
	constructor(
		message: string,
		public cycle: string[],
	) {
		super(message);
		this.name = 'CircularDependencyError';
	}
}

export class StepExecutionError extends Error {
	constructor(
		message: string,
		public stepName: string,
		public toolType: ToolType,
		public cause?: Error,
	) {
		super(message);
		this.name = 'StepExecutionError';
	}
}

// Type Guard Functions
export function isTemplateStep(step: RecipeStepUnion): step is TemplateStep {
	return step.tool === 'template';
}

export function isActionStep(step: RecipeStepUnion): step is ActionStep {
	return step.tool === 'action';
}

export function isCodeModStep(step: RecipeStepUnion): step is CodeModStep {
	return step.tool === 'codemod';
}

export function isRecipeStep(step: RecipeStepUnion): step is RecipeStepType {
	return step.tool === 'recipe';
}
