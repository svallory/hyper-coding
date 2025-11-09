import createDebug from 'debug';
import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';
import { DEFAULT_CONFIG } from '../config.js';
import type { ToolType } from '../types.js';
import type {
	RecipeExecutionPlan,
	RecipeStepUnion,
	StepContext,
	StepDependencyNode,
	StepExecutionMetrics,
	StepExecutorConfig,
} from './step-executor-types.js';
import { CircularDependencyError } from './step-executor-types.js';

const debug = createDebug(
	'hypergen:v8:recipe:step-executor:dependency-resolver',
);

export class DependencyResolver {
	private readonly config: StepExecutorConfig;
	private metrics?: StepExecutionMetrics;

	constructor(config: StepExecutorConfig, metrics?: StepExecutionMetrics) {
		this.config = config;
		this.metrics = metrics;
	}

	async createExecutionPlan(
		steps: RecipeStepUnion[],
		context: StepContext,
	): Promise<RecipeExecutionPlan> {
		const startTime = Date.now();

		// Build dependency graph
		const dependencyGraph = this.buildDependencyGraph(steps);

		// Detect circular dependencies
		this.detectCircularDependencies(dependencyGraph);

		// Create execution phases using topological sort
		const phases = this.createExecutionPhases(steps, dependencyGraph);

		const plan: RecipeExecutionPlan = {
			recipe: {
				name: context.recipe.name,
				description: 'Recipe execution plan',
				version: context.recipe.version,
				author: undefined,
				category: undefined,
				tags: [],
				variables: context.recipeVariables,
				steps,
				examples: [],
				dependencies: [],
				outputs: [],
			},
			phases,
			dependencyGraph,
			estimatedDuration: this.estimateExecutionDuration(steps),
		};

		if (this.config.collectMetrics && this.metrics) {
			this.metrics.dependencies.resolutionTime = Date.now() - startTime;
		}

		return plan;
	}

	private buildDependencyGraph(
		steps: RecipeStepUnion[],
	): Map<string, StepDependencyNode> {
		const graph = new Map<string, StepDependencyNode>();

		// Initialize nodes
		for (const step of steps) {
			graph.set(step.name, {
				stepName: step.name,
				dependencies: step.dependsOn || [],
				dependents: [],
				priority: 0,
				parallelizable: step.parallel ?? true,
			});
		}

		// Build dependent relationships
		for (const [stepName, node] of graph) {
			for (const depName of node.dependencies) {
				const depNode = graph.get(depName);
				if (depNode) {
					depNode.dependents.push(stepName);
				}
			}
		}

		// Calculate priority based on dependency depth
		this.calculatePriorities(graph);

		return graph;
	}

	private calculatePriorities(graph: Map<string, StepDependencyNode>): void {
		const visited = new Set<string>();

		const calculatePriority = (stepName: string): number => {
			if (visited.has(stepName)) {
				return graph.get(stepName)?.priority ?? 0;
			}

			visited.add(stepName);
			const node = graph.get(stepName);
			if (!node) {
				return 0; // Should not happen if graph is built correctly
			}
			if (node.dependencies.length === 0) {
				node.priority = 0;
				return 0;
			}

			let maxDepPriority = -1;
			for (const depName of node.dependencies) {
				const depPriority = calculatePriority(depName);
				maxDepPriority = Math.max(maxDepPriority, depPriority);
			}

			node.priority = maxDepPriority + 1;
			return node.priority;
		};

		for (const stepName of graph.keys()) {
			calculatePriority(stepName);
		}
	}

	private detectCircularDependencies(
		graph: Map<string, StepDependencyNode>,
	): void {
		const visited = new Set<string>();
		const visiting = new Set<string>();

		const visit = (stepName: string, path: string[] = []): void => {
			if (visiting.has(stepName)) {
				const cycle = [...path.slice(path.indexOf(stepName)), stepName];
				if (this.config.collectMetrics && this.metrics) {
					this.metrics.dependencies.cyclesDetected++;
				}
				throw new CircularDependencyError(
					`Circular dependency detected: ${cycle.join(' -> ')}`,
					cycle,
				);
			}

			if (visited.has(stepName)) {
				return;
			}

			visiting.add(stepName);
			const node = graph.get(stepName);
			if (!node) {
				visiting.delete(stepName);
				visited.add(stepName);
				return;
			}

			for (const depName of node.dependencies) {
				visit(depName, [...path, stepName]);
			}

			visiting.delete(stepName);
			visited.add(stepName);
		};

		for (const stepName of graph.keys()) {
			visit(stepName);
		}
	}

	private createExecutionPhases(
		steps: RecipeStepUnion[],
		graph: Map<string, StepDependencyNode>,
	): RecipeExecutionPlan['phases'] {
		const phases: RecipeExecutionPlan['phases'] = [];
		const assigned = new Set<string>();
		const stepMap = new Map(steps.map((step) => [step.name, step]));

		while (assigned.size < steps.length) {
			const readySteps: string[] = [];

			// Find steps that can run in this phase
			for (const [stepName, node] of graph) {
				if (assigned.has(stepName)) continue;

				// Check if all dependencies are satisfied
				const dependenciesSatisfied = node.dependencies.every((dep) =>
					assigned.has(dep),
				);

				if (dependenciesSatisfied) {
					readySteps.push(stepName);
				}
			}

			if (readySteps.length === 0) {
				throw ErrorHandler.createError(
					ErrorCode.INTERNAL_ERROR,
					'No ready steps found - possible circular dependency',
					{ assigned: Array.from(assigned), total: steps.length },
				);
			}

			// Determine if this phase can run in parallel
			const canRunInParallel =
				this.config.enableParallelExecution &&
				readySteps.length > 1 &&
				readySteps.every((stepName) => {
					const step = stepMap.get(stepName);
					if (!step) {
						return false;
					}
					return step.parallel !== false;
				});

			phases.push({
				phase: phases.length,
				steps: readySteps,
				parallel: canRunInParallel,
			});

			// Mark steps as assigned
			for (const stepName of readySteps) {
				assigned.add(stepName);
			}
		}

		return phases;
	}

	private estimateExecutionDuration(steps: RecipeStepUnion[]): number {
		// Simple estimation based on step types and historical data
		const estimations: Record<ToolType, number> = {
			template: 5000, // 5 seconds average
			action: 3000, // 3 seconds average
			codemod: 10000, // 10 seconds average
			recipe: 15000, // 15 seconds average (sub-recipes)
		};

		let totalEstimate = 0;
		for (const step of steps) {
			totalEstimate += estimations[step.tool] || 5000;
		}

		return totalEstimate;
	}
}
