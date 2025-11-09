/**
 * Recipe Engine Tests
 *
 * Tests for the main RecipeEngine orchestrator
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TemplateParser } from '../src/config/template-parser.js';
import {
	RecipeEngine,
	createRecipeEngine,
	executeRecipe,
	loadRecipe,
	validateRecipe,
} from '../src/recipe-engine/recipe-engine.js';
import type { RecipeConfig, RecipeSource } from '../src/recipe-engine/types.js';

describe('RecipeEngine', () => {
	let engine: RecipeEngine;

	beforeEach(() => {
		engine = createRecipeEngine({
			enableDebugLogging: false,
			cache: { enabled: false },
			security: { allowExternalSources: false },
		});
	});

	afterEach(async () => {
		await engine.cleanup();
	});

	describe('Recipe Loading', () => {
		it('should load a recipe from content source', async () => {
			const recipeContent = `
name: Test Recipe
description: A test recipe
version: 1.0.0
variables:
  name:
    type: string
    required: true
    default: TestComponent
    description: Component name
steps:
  - name: create-component
    tool: template
    template: component
    description: Create a React component
    variables:
      name: "{{ name }}"
`;

			const source: RecipeSource = {
				type: 'content',
				content: recipeContent,
				name: 'test-recipe',
			};

			const result = await engine.loadRecipe(source);

			expect(result.recipe.name).toBe('Test Recipe');
			expect(result.recipe.description).toBe('A test recipe');
			expect(result.recipe.version).toBe('1.0.0');
			expect(result.recipe.steps).toHaveLength(1);
			expect(result.recipe.steps[0].name).toBe('create-component');
			expect(result.recipe.steps[0].tool).toBe('template');
			expect(result.validation.isValid).toBe(true);
		});

		it('should validate recipe configuration', async () => {
			const invalidRecipe: RecipeConfig = {
				name: '', // Invalid: empty name
				variables: {},
				steps: [], // Invalid: no steps
			};

			const validation = await engine.validateRecipe(invalidRecipe);

			expect(validation.isValid).toBe(false);
			expect(validation.errors).toHaveLength(2); // name, steps
		});

		it('should handle recipe with missing required fields', async () => {
			const recipeContent = `
description: Recipe without name
variables: {}
steps: []
`;

			const source: RecipeSource = {
				type: 'content',
				content: recipeContent,
				name: 'invalid-recipe',
			};

			const result = await engine.loadRecipe(source);

			expect(result.validation.isValid).toBe(false);
			expect(
				result.validation.errors.some((e) => e.code === 'MISSING_NAME'),
			).toBe(true);
			expect(
				result.validation.errors.some((e) => e.code === 'MISSING_STEPS'),
			).toBe(true);
		});
	});

	describe('Recipe Validation', () => {
		it('should validate step dependencies', async () => {
			const recipe: RecipeConfig = {
				name: 'Test Recipe',
				variables: {
					name: {
						type: 'string',
						required: true,
						default: 'Test',
					},
				},
				steps: [
					{
						name: 'step1',
						tool: 'template',
						template: 'component',
						dependsOn: ['nonexistent-step'], // Invalid dependency
					},
				],
			};

			const validation = await engine.validateRecipe(recipe);

			expect(validation.isValid).toBe(false);
			expect(
				validation.errors.some((e) => e.code === 'UNKNOWN_DEPENDENCY'),
			).toBe(true);
		});

		it('should detect duplicate step names', async () => {
			const recipe: RecipeConfig = {
				name: 'Test Recipe',
				variables: {},
				steps: [
					{
						name: 'duplicate',
						tool: 'template',
						template: 'component',
					},
					{
						name: 'duplicate', // Duplicate name
						tool: 'action',
						action: 'test',
					},
				],
			};

			const validation = await engine.validateRecipe(recipe);

			expect(validation.isValid).toBe(false);
			expect(
				validation.errors.some((e) => e.code === 'DUPLICATE_STEP_NAME'),
			).toBe(true);
		});

		it('should validate variable configurations', async () => {
			const recipe: RecipeConfig = {
				name: 'Test Recipe',
				variables: {
					invalidVar: {
						type: 'invalid-type' as any, // Invalid type
						required: true,
					},
				},
				steps: [],
			};

			const validation = await engine.validateRecipe(recipe);

			expect(validation.isValid).toBe(false);
			expect(validation.errors.some((e) => e.code === 'INVALID_VARIABLE')).toBe(
				true,
			);
		});
	});

	describe('Variable Resolution', () => {
		it('should resolve variables with defaults', async () => {
			const recipeContent = `
name: Variable Test
variables:
  name:
    type: string
    default: DefaultName
  enabled:
    type: boolean
    default: false
steps:
  - name: test-step
    tool: template
    template: test
`;

			const source: RecipeSource = {
				type: 'content',
				content: recipeContent,
				name: 'variable-test',
			};

			// Mock the step executor to avoid actual execution
			const originalExecuteSteps = engine.stepExecutor.executeSteps;
			engine.stepExecutor.executeSteps = async () => [];

			try {
				const result = await engine.executeRecipe(source, {
					skipPrompts: true,
				});

				expect(result.variables.name).toBe('DefaultName');
				expect(result.variables.enabled).toBe(false);
			} finally {
				engine.stepExecutor.executeSteps = originalExecuteSteps;
			}
		});

		it('should override defaults with provided variables', async () => {
			const recipeContent = `
name: Variable Override Test
variables:
  name:
    type: string
    default: DefaultName
  count:
    type: number
    default: 1
steps:
  - name: test-step
    tool: template
    template: test
`;

			const source: RecipeSource = {
				type: 'content',
				content: recipeContent,
				name: 'variable-override-test',
			};

			// Mock the step executor
			const originalExecuteSteps = engine.stepExecutor.executeSteps;
			engine.stepExecutor.executeSteps = async () => [];

			try {
				const result = await engine.executeRecipe(source, {
					variables: {
						name: 'CustomName',
						count: 5,
					},
					skipPrompts: true,
				});

				expect(result.variables.name).toBe('CustomName');
				expect(result.variables.count).toBe(5);
			} finally {
				engine.stepExecutor.executeSteps = originalExecuteSteps;
			}
		});

		it('should fail on missing required variables', async () => {
			const recipeContent = `
name: Required Variable Test
variables:
  name:
    type: string
    required: true
steps:
  - name: test-step
    tool: template
    template: test
`;

			const source: RecipeSource = {
				type: 'content',
				content: recipeContent,
				name: 'required-variable-test',
			};

			await expect(
				engine.executeRecipe(source, {
					skipPrompts: true, // Skip prompts, should fail on missing required
				}),
			).rejects.toThrow(/Missing required variables/);
		});
	});

	describe('Utility Functions', () => {
		it('createRecipeEngine should create a new instance', () => {
			const newEngine = createRecipeEngine();
			expect(newEngine).toBeInstanceOf(RecipeEngine);
			expect(newEngine).not.toBe(engine);
		});

		it('executeRecipe should work with default engine', async () => {
			const recipeContent = `
name: Quick Test
variables: {}
steps: []
`;

			// Mock to avoid actual execution
			const mockEngine = createRecipeEngine();
			const originalExecuteSteps = mockEngine.stepExecutor.executeSteps;
			mockEngine.stepExecutor.executeSteps = async () => [];

			try {
				const result = await mockEngine.executeRecipe({
					type: 'content',
					content: `
name: Quick Test
variables: {}
steps:
  - name: test-step
    tool: template
    template: test
`,
					name: 'quick-test',
				});

				expect(result.success).toBe(true);
			} finally {
				mockEngine.stepExecutor.executeSteps = originalExecuteSteps;
				await mockEngine.cleanup();
			}
		});
	});

	describe('Error Handling', () => {
		it('should handle malformed YAML gracefully', async () => {
			const source: RecipeSource = {
				type: 'content',
				content: 'invalid: yaml: content: [',
				name: 'malformed',
			};

			await expect(engine.loadRecipe(source)).rejects.toThrow();
		});

		it('should handle missing recipe files', async () => {
			const source: RecipeSource = {
				type: 'file',
				path: '/nonexistent/recipe.yml',
			};

			await expect(engine.loadRecipe(source)).rejects.toThrow(/not found/);
		});

		it('should respect security settings for external sources', async () => {
			const source: RecipeSource = {
				type: 'url',
				url: 'https://example.com/recipe.yml',
			};

			// Security is disabled in our test setup
			await expect(engine.loadRecipe(source)).rejects.toThrow(/not allowed/);
		});
	});
});

describe('Template Variable Validation', () => {
	it('should validate string variables with patterns', () => {
		const variable = {
			type: 'string' as const,
			pattern: '^[A-Z][a-zA-Z0-9]*$',
		};

		const valid = TemplateParser.validateVariableValue(
			'testVar',
			'ValidName',
			variable,
		);
		const invalid = TemplateParser.validateVariableValue(
			'testVar',
			'invalid-name',
			variable,
		);

		expect(valid.isValid).toBe(true);
		expect(invalid.isValid).toBe(false);
	});

	it('should validate number variables with min/max', () => {
		const variable = {
			type: 'number' as const,
			min: 1,
			max: 100,
		};

		const valid = TemplateParser.validateVariableValue('testVar', 50, variable);
		const tooLow = TemplateParser.validateVariableValue('testVar', 0, variable);
		const tooHigh = TemplateParser.validateVariableValue(
			'testVar',
			101,
			variable,
		);

		expect(valid.isValid).toBe(true);
		expect(tooLow.isValid).toBe(false);
		expect(tooHigh.isValid).toBe(false);
	});

	it('should validate enum variables', () => {
		const variable = {
			type: 'enum' as const,
			values: ['react', 'vue', 'angular'],
		};

		const valid = TemplateParser.validateVariableValue(
			'framework',
			'react',
			variable,
		);
		const invalid = TemplateParser.validateVariableValue(
			'framework',
			'svelte',
			variable,
		);

		expect(valid.isValid).toBe(true);
		expect(invalid.isValid).toBe(false);
	});

	it('should handle default values correctly', () => {
		const variable = {
			type: 'string' as const,
			default: 'DefaultValue',
		};

		const resolved = TemplateParser.getResolvedValue(undefined, variable);
		expect(resolved).toBe('DefaultValue');

		const provided = TemplateParser.getResolvedValue('ProvidedValue', variable);
		expect(provided).toBe('ProvidedValue');
	});
});
