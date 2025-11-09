/**
 * Action Tool Integration Tests
 *
 * Tests the ActionTool implementation with the Recipe Step System
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ActionExecutor } from '../../src/actions/executor.js';
import { ActionRegistry } from '../../src/actions/registry.js';
import type {
	ActionContext,
	ActionMetadata,
	ActionResult,
} from '../../src/actions/types.js';
import {
	ActionTool,
	ActionToolFactory,
} from '../../src/recipe-engine/tools/action-tool.js';
import type {
	ActionStep,
	StepContext,
	StepExecutionOptions,
} from '../../src/recipe-engine/types.js';

describe('ActionTool', () => {
	let actionTool: ActionTool;
	let registry: ActionRegistry;
	let mockStepContext: StepContext;

	// Mock action function
	const mockActionFunction = vi.fn(
		async (context: ActionContext): Promise<ActionResult> => {
			return {
				success: true,
				message: `Test action executed with ${Object.keys(context.variables).length} parameters`,
				filesCreated: ['test-file.txt'],
				filesModified: [],
				filesDeleted: [],
			};
		},
	);

	// Mock action metadata
	const mockActionMetadata: ActionMetadata = {
		name: 'test-action',
		description: 'Test action for unit tests',
		category: 'testing',
		parameters: [
			{
				name: 'testParam',
				type: 'string',
				required: true,
				description: 'Test parameter',
			},
			{
				name: 'optionalParam',
				type: 'boolean',
				required: false,
				default: false,
				description: 'Optional test parameter',
			},
		],
		tags: ['test', 'mock'],
		examples: [
			{
				title: 'Basic usage',
				description: 'Basic test action usage',
				parameters: {
					testParam: 'hello',
					optionalParam: true,
				},
			},
		],
	};

	beforeEach(() => {
		// Clear registry before each test
		registry = ActionRegistry.getInstance();
		registry.clear();

		// Register mock action
		registry.register(mockActionFunction, mockActionMetadata);

		// Create action tool
		actionTool = new ActionTool('test-action-tool');

		// Mock step context
		mockStepContext = {
			step: {
				name: 'test-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'test-value',
				},
			} as ActionStep,
			variables: {
				projectName: 'test-project',
				version: '1.0.0',
			},
			projectRoot: '/test/project',
			recipeVariables: {
				environment: 'development',
			},
			stepResults: new Map(),
			recipe: {
				id: 'test-recipe',
				name: 'Test Recipe',
				startTime: new Date(),
			},
			stepData: {},
			evaluateCondition: vi.fn((expr, ctx) => true),
			dryRun: false,
			force: false,
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Initialization', () => {
		test('should initialize successfully', async () => {
			await actionTool.initialize();

			expect(actionTool.isInitialized()).toBe(true);
			expect(actionTool.getToolType()).toBe('action');
		});

		test('should handle initialization errors gracefully', async () => {
			// Create tool with invalid configuration
			const invalidTool = new ActionTool('invalid-tool', {
				communicationConfig: 'invalid', // Should be object
			});

			// Should initialize despite config issues (the ActionExecutor handles config gracefully)
			await invalidTool.initialize();
			expect(invalidTool.isInitialized()).toBe(true);
		});
	});

	describe('Validation', () => {
		test('should validate correct action step configuration', async () => {
			const validStep: ActionStep = {
				name: 'valid-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'valid-value',
				},
			};

			const result = await actionTool.validate(validStep, mockStepContext);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.estimatedExecutionTime).toBeGreaterThan(0);
		});

		test('should reject invalid step type', async () => {
			const invalidStep = {
				name: 'invalid-step',
				tool: 'template', // Wrong tool type
				action: 'test-action',
			} as any;

			const result = await actionTool.validate(invalidStep, mockStepContext);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain('Step is not a valid ActionStep');
		});

		test('should reject missing action name', async () => {
			const invalidStep: ActionStep = {
				name: 'no-action-step',
				tool: 'action',
				action: '', // Empty action name
				parameters: {},
			};

			const result = await actionTool.validate(invalidStep, mockStepContext);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain('Action name is required');
		});

		test('should reject non-existent action', async () => {
			const invalidStep: ActionStep = {
				name: 'nonexistent-step',
				tool: 'action',
				action: 'nonexistent-action',
				parameters: {},
			};

			const result = await actionTool.validate(invalidStep, mockStepContext);

			expect(result.isValid).toBe(false);
			expect(result.errors).toContain(
				"Action 'nonexistent-action' not found in registry",
			);
		});

		test('should warn about missing required parameters', async () => {
			const incompleteStep: ActionStep = {
				name: 'incomplete-step',
				tool: 'action',
				action: 'test-action',
				parameters: {}, // Missing required testParam
			};

			const result = await actionTool.validate(incompleteStep, mockStepContext);

			// Should be valid because parameters can be prompted interactively
			expect(result.isValid).toBe(true);
			expect(
				result.warnings.some((w) => w.includes('Missing required parameters')),
			).toBe(true);
			expect(
				result.suggestions.some((s) => s.includes('prompted interactively')),
			).toBe(true);
		});

		test('should validate communication configuration', async () => {
			const stepWithComm: ActionStep = {
				name: 'comm-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'test-value',
				},
				actionConfig: {
					communication: {
						actionId: 'test-action-id',
						subscribeTo: ['message-type-1'],
						reads: ['shared-data-key'],
						writes: ['output-data-key'],
					},
				},
			};

			const result = await actionTool.validate(stepWithComm, mockStepContext);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test('should reject invalid communication configuration', async () => {
			const stepWithInvalidComm: ActionStep = {
				name: 'invalid-comm-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'test-value',
				},
				actionConfig: {
					communication: {
						actionId: 123 as any, // Should be string
						subscribeTo: 'not-array' as any, // Should be array
						reads: ['valid'],
						writes: ['valid'],
					},
				},
			};

			const result = await actionTool.validate(
				stepWithInvalidComm,
				mockStepContext,
			);

			expect(result.isValid).toBe(false);
			expect(
				result.errors.some((e) => e.includes('actionId must be a string')),
			).toBe(true);
			expect(
				result.errors.some((e) => e.includes('subscribeTo must be an array')),
			).toBe(true);
		});
	});

	describe('Execution', () => {
		test('should execute action successfully', async () => {
			const actionStep: ActionStep = {
				name: 'execute-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'execution-test',
					optionalParam: true,
				},
			};

			const result = await actionTool.execute(actionStep, mockStepContext);

			expect(result.status).toBe('completed');
			expect(result.stepName).toBe('execute-step');
			expect(result.toolType).toBe('action');
			expect(result.filesCreated).toEqual(['test-file.txt']);
			expect(result.toolResult).toBeDefined();
			expect(result.metadata?.actionMetadata).toBeDefined();
			expect(mockActionFunction).toHaveBeenCalledOnce();
		});

		test('should handle dry run mode', async () => {
			const actionStep: ActionStep = {
				name: 'dry-run-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'dry-run-test',
				},
			};

			const options: StepExecutionOptions = {
				dryRun: true,
			};

			const result = await actionTool.execute(
				actionStep,
				mockStepContext,
				options,
			);

			expect(result.status).toBe('completed');
			expect(result.toolResult).toBeDefined();

			// In dry run mode, the ActionExecutor should return a dry run result
			const actionResult = result.toolResult as ActionResult;
			expect(actionResult.success).toBe(true);
			expect(actionResult.message).toContain('[DRY RUN]');
		});

		test('should merge variables from different sources', async () => {
			const actionStep: ActionStep = {
				name: 'variable-merge-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'step-param',
				},
				variables: {
					stepVariable: 'step-value',
				},
			};

			// Update context with additional variables
			const contextWithVars = {
				...mockStepContext,
				variables: {
					...mockStepContext.variables,
					contextVariable: 'context-value',
				},
				recipeVariables: {
					...mockStepContext.recipeVariables,
					recipeVariable: 'recipe-value',
				},
			};

			const result = await actionTool.execute(actionStep, contextWithVars);

			expect(result.status).toBe('completed');
			expect(mockActionFunction).toHaveBeenCalledWith(
				expect.objectContaining({
					variables: expect.objectContaining({
						testParam: 'step-param',
						stepVariable: 'step-value',
						contextVariable: 'context-value',
						recipeVariable: 'recipe-value',
					}),
				}),
			);
		});

		test('should handle action execution failure', async () => {
			// Register a failing action
			const failingAction = vi.fn(async (): Promise<ActionResult> => {
				return {
					success: false,
					message: 'Action failed for testing',
					filesCreated: [],
					filesModified: [],
					filesDeleted: [],
				};
			});

			const failingMetadata: ActionMetadata = {
				name: 'failing-action',
				description: 'Action that fails for testing',
				parameters: [],
			};

			registry.register(failingAction, failingMetadata);

			const failingStep: ActionStep = {
				name: 'failing-step',
				tool: 'action',
				action: 'failing-action',
				parameters: {},
			};

			const result = await actionTool.execute(failingStep, mockStepContext);

			// If an action returns success: false, the step should be marked as failed
			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();
			expect(result.error?.message).toContain('Action failed for testing');
		});

		test('should handle action throwing error', async () => {
			// Register an action that throws
			const throwingAction = vi.fn(async (): Promise<ActionResult> => {
				throw new Error('Action threw an error');
			});

			const throwingMetadata: ActionMetadata = {
				name: 'throwing-action',
				description: 'Action that throws for testing',
				parameters: [],
			};

			registry.register(throwingAction, throwingMetadata);

			const throwingStep: ActionStep = {
				name: 'throwing-step',
				tool: 'action',
				action: 'throwing-action',
				parameters: {},
			};

			const result = await actionTool.execute(throwingStep, mockStepContext);

			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();
			expect(result.error?.message).toContain('Action threw an error');
		});

		test('should track execution statistics', async () => {
			const actionStep: ActionStep = {
				name: 'stats-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'stats-test',
				},
			};

			// Execute action
			await actionTool.execute(actionStep, mockStepContext);

			// Check execution stats
			const stats = actionTool.getExecutionStats();
			expect(stats.totalActions).toBeGreaterThan(0);
			expect(stats).toHaveProperty('completedActions');
			expect(stats).toHaveProperty('failedActions');
			expect(stats).toHaveProperty('communicationStats');
		});
	});

	describe('Communication', () => {
		test('should handle action communication configuration', async () => {
			const commStep: ActionStep = {
				name: 'communication-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'communication-test',
				},
				actionConfig: {
					communication: {
						actionId: 'custom-action-id',
						subscribeTo: ['step-complete'],
						reads: ['shared-config'],
						writes: ['step-output'],
					},
				},
			};

			const result = await actionTool.execute(commStep, mockStepContext);

			expect(result.status).toBe('completed');
			expect(result.output?.communication).toBeDefined();
			expect(result.output?.communication).toMatchObject({
				actionId: 'custom-action-id',
				subscribeTo: ['step-complete'],
				reads: ['shared-config'],
				writes: ['step-output'],
			});
		});
	});

	describe('Utility Methods', () => {
		test('should get available actions', () => {
			const actions = actionTool.getAvailableActions();

			expect(actions).toHaveLength(1);
			expect(actions[0]).toMatchObject({
				name: 'test-action',
				description: 'Test action for unit tests',
				category: 'testing',
				parameterCount: 2,
				requiredParameters: ['testParam'],
			});
		});

		test('should search actions', () => {
			const results = actionTool.searchActions('test');

			expect(results).toContain('test-action');
		});

		test('should get actions by category', () => {
			const testingActions = actionTool.getActionsByCategory('testing');

			expect(testingActions).toContain('test-action');
		});

		test('should validate action parameters', async () => {
			const validationResult = await actionTool.validateActionParameters(
				'test-action',
				{
					testParam: 'valid-value',
					optionalParam: false,
				},
			);

			expect(validationResult.valid).toBe(true);
			expect(validationResult.errors).toHaveLength(0);
		});

		test('should detect invalid action parameters', async () => {
			const validationResult = await actionTool.validateActionParameters(
				'test-action',
				{
					// Missing required testParam
					optionalParam: false,
				},
			);

			expect(validationResult.valid).toBe(false);
			expect(validationResult.errors.length).toBeGreaterThan(0);
		});
	});

	describe('Cleanup', () => {
		test('should cleanup resources properly', async () => {
			await actionTool.initialize();

			// Execute an action to create some state
			const actionStep: ActionStep = {
				name: 'cleanup-test-step',
				tool: 'action',
				action: 'test-action',
				parameters: {
					testParam: 'cleanup-test',
				},
			};
			await actionTool.execute(actionStep, mockStepContext);

			// Cleanup
			await actionTool.cleanup();

			expect(actionTool.isCleanedUp()).toBe(true);
		});
	});

	describe('Factory', () => {
		test('should create action tool through factory', () => {
			const factory = new ActionToolFactory();
			const tool = factory.create('factory-tool');

			expect(tool).toBeInstanceOf(ActionTool);
			expect(tool.getName()).toBe('factory-tool');
			expect(tool.getToolType()).toBe('action');
		});

		test('should validate factory configuration', () => {
			const factory = new ActionToolFactory();

			const validConfig = {
				communicationConfig: {
					maxMessages: 1000,
					ttl: 30000,
				},
				defaultTimeout: 5000,
			};

			const result = factory.validateConfig(validConfig);
			expect(result.isValid).toBe(true);
		});

		test('should reject invalid factory configuration', () => {
			const factory = new ActionToolFactory();

			const invalidConfig = {
				communicationConfig: 'invalid', // Should be object
				defaultTimeout: -1000, // Should be positive
			};

			const result = factory.validateConfig(invalidConfig);
			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});
	});
});
