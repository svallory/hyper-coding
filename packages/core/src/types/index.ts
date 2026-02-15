/**
 * @hypercli/core Type Definitions
 *
 * Additional type definitions for types not already available from parsers.
 * Many types like TemplateConfig, TemplateVariable, RecipeConfig, etc. are
 * already exported from ../parsers/index.js and should be imported from there.
 */

// Kit types (these are specific to kit.yml and not in parsers)
export type {
	VariableDefinition,
	VariableType,
	VariableValidation,
	KitConfig,
	CookbookConfig,
	ValidationError,
} from "./kit.js";
export { TemplateConfigError } from "./kit.js";

// Recipe types
// Note: RecipeConfig, RecipeStepUnion, and ToolType are already exported from ../parsers/index.js
export type {
	RecipeProvides,
	StepStatus,
	BaseRecipeStep,
	TemplateStep,
	ActionStep,
	CodeModStep,
	RecipeStep,
	ShellStep,
	PromptStep,
	InstallStep,
	QueryStep,
	PatchStep,
	EnsureDirsStep,
	SequenceStep,
	ParallelStep,
	AIStep,
	StepContext,
	StepResult,
	TemplateExecutionResult,
	CodeModExecutionResult,
	ShellExecutionResult,
	PromptExecutionResult,
	SequenceExecutionResult,
	ParallelExecutionResult,
	InstallExecutionResult,
	QueryExecutionResult,
	PatchExecutionResult,
	EnsureDirsExecutionResult,
	RecipeExecutionResult,
	RecipeExample,
	RecipeDependency,
	RecipeExecution,
	RecipeValidationResult,
	RecipeValidationError,
	RecipeValidationWarning,
	StepDependencyNode,
	RecipeExecutionPlan,
	StepExecutionOptions,
	RecipeEngineConfig,
	StepByTool,
} from "./recipe.js";
export {
	isTemplateStep,
	isActionStep,
	isCodeModStep,
	isRecipeStep,
	isShellStep,
	isPromptStep,
	isSequenceStep,
	isParallelStep,
	isAIStep,
	isInstallStep,
	isQueryStep,
	isPatchStep,
	isEnsureDirsStep,
	RecipeValidationError as RecipeValidationErrorClass,
	StepExecutionError,
	RecipeDependencyError,
	CircularDependencyError,
} from "./recipe.js";

// Action types (ActionLogger re-exported from ./actions.js which imports from ../logger/types.js)
export type {
	ActionMetadata,
	ActionParameter,
	ParameterType,
	ParameterValidation,
	ActionContext,
	ActionCommunication,
	ActionResult,
	ActionFunction,
	DecoratedAction,
	ActionExample,
	ActionUtils,
	ActionQueryOptions,
} from "./actions.js";
export type { ActionLogger } from "#/logger/types.js";
export { ActionExecutionError, ActionParameterError } from "./actions.js";

// AI Configuration types (AiServiceConfig also available from ../config/index.js)
export type {
	AIModelRef,
	AIModelPricing,
	AIBudgetConfig,
	AIOutputConfig,
	AIContextConfig,
	AIExample,
	AIGuardrailConfig,
	AIExecutionResult,
	AICostSummary,
} from "./ai-config.js";
// Re-export AiServiceConfig from config
export type { AiServiceConfig } from "#/config/index.js";

// Common types
// Note: Logger is already exported as a class from '#/logger/index'
// ExtendedLogger type interface is also available from '#/logger/types'
export type { Prompter, RenderedAction, RunnerConfig } from "./common.js";
