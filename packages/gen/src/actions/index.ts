/**
 * Action System
 *
 * Export point for the decorator-based action system
 */

export { action, getActionMetadata, isActionFunction } from "./decorator.js";
export { ActionExecutor } from "./executor.js";
export { ActionParameterResolver } from "./parameter-resolver.js";
export { ActionRegistry } from "./registry.js";
// Re-export main types for convenience
export type {
	ActionContext,
	ActionFunction,
	ActionLogger,
	ActionMetadata,
	ActionParameter,
	ActionResult,
	ActionUtils,
	DecoratedAction,
} from "./types.js";
// Core exports
export * from "./types.js";

// Explicitly export error classes
export { ActionExecutionError, ActionParameterError } from "./types.js";
export {
	ConsoleActionLogger,
	DefaultActionUtils,
	SilentActionLogger,
} from "./utils.js";
