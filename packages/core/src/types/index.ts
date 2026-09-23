/**
 * @hypercli/core Type Definitions
 *
 * Additional type definitions for types not already available from parsers.
 * Many types like TemplateConfig, TemplateVariable, RecipeConfig, etc. are
 * already exported from ../parsers/index.js and should be imported from there.
 */

// Re-export AiServiceConfig from config
export type { AiServiceConfig } from "#config/index";
export type { ActionLogger } from "#logger/types";
// Action types (ActionLogger re-exported from ./actions.js which imports from ../logger/types.js)
export type {
	ActionCommunication,
	ActionContext,
	ActionExample,
	ActionFunction,
	ActionMetadata,
	ActionParameter,
	ActionQueryOptions,
	ActionResult,
	ActionUtils,
	DecoratedAction,
	ParameterType,
	ParameterValidation,
} from "./actions.js";
export { ActionExecutionError, ActionParameterError } from "./actions.js";
// AI Configuration types (AiServiceConfig also available from ../config/index.js)
export type {
	AIBudgetConfig,
	AIContextConfig,
	AICostSummary,
	AIExample,
	AIExecutionResult,
	AIGuardrailConfig,
	AIModelPricing,
	AIModelRef,
	AIOutputConfig,
} from "./ai-config.js";
// Common types
// Note: Logger is already exported as a class from '#logger/index'
// ExtendedLogger type interface is also available from '#logger/types'
export type { Prompter, RenderedAction, RunnerConfig } from "./common.js";
// Kit types (these are specific to kit.yml and not in parsers)
export type {
	CookbookConfig,
	KitConfig,
	ValidationError,
	VariableDefinition,
	VariableType,
	VariableValidation,
} from "./kit.js";
export { TemplateConfigError } from "./kit.js";
// Recipe types
// Note: RecipeConfig, RecipeStepUnion, and ToolType are already exported from ../parsers/index.js
export type {
	ActionStep,
	AIStep,
	BaseRecipeStep,
	CodeModExecutionResult,
	CodeModStep,
	EnsureDirsExecutionResult,
	EnsureDirsStep,
	InstallExecutionResult,
	InstallStep,
	ParallelExecutionResult,
	ParallelStep,
	PatchExecutionResult,
	PatchStep,
	PromptExecutionResult,
	PromptStep,
	QueryExecutionResult,
	QueryStep,
	RecipeDependency,
	RecipeEngineConfig,
	RecipeExample,
	RecipeExecution,
	RecipeExecutionPlan,
	RecipeExecutionResult,
	RecipeProvides,
	RecipeStep,
	RecipeValidationError,
	RecipeValidationResult,
	RecipeValidationWarning,
	SequenceExecutionResult,
	SequenceStep,
	ShellExecutionResult,
	ShellStep,
	StepByTool,
	StepContext,
	StepDependencyNode,
	StepExecutionOptions,
	StepResult,
	StepStatus,
	TemplateExecutionResult,
	TemplateStep,
} from "./recipe.js";
export {
	CircularDependencyError,
	isActionStep,
	isAIStep,
	isCodeModStep,
	isEnsureDirsStep,
	isInstallStep,
	isParallelStep,
	isPatchStep,
	isPromptStep,
	isQueryStep,
	isRecipeStep,
	isSequenceStep,
	isShellStep,
	isTemplateStep,
	RecipeDependencyError,
	RecipeValidationError as RecipeValidationErrorClass,
	StepExecutionError,
} from "./recipe.js";
// Template types (used by recipe engine and actions)
export type {
	TemplateConfig,
	TemplateExample,
	TemplateVariable,
} from "./template.js";
