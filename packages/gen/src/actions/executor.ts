/**
 * Action Execution Engine
 *
 * Handles action discovery, parameter resolution, and execution
 */

import { ErrorCode, ErrorHandler, HypergenError } from "@hypercli/core";
import createDebug from "debug";
import {
	type ActionCommunicationManager,
	type CommunicationConfig,
	getCommunicationManager,
} from "./communication.js";
import { ActionParameterResolver } from "./parameter-resolver.js";
import { ActionRegistry } from "./registry.js";
import type { ActionContext, ActionResult } from "./types.js";
import { ActionExecutionError } from "./types.js";
import { ConsoleActionLogger, DefaultActionUtils } from "./utils.js";

const debug = createDebug("hyper:action:executor");

export class ActionExecutor {
	private parameterResolver = new ActionParameterResolver();
	private defaultUtils = new DefaultActionUtils();
	private defaultLogger = new ConsoleActionLogger();
	private communicationManager: ActionCommunicationManager;

	constructor(communicationConfig?: Partial<CommunicationConfig>) {
		// Initialize communication manager
		this.communicationManager = getCommunicationManager(communicationConfig);
	}

	/**
	 * Execute an action (internal method)
	 */
	public async execute(
		actionName: string,
		parameters: Record<string, any> = {},
		context: Partial<ActionContext> = {},
		options: {
			dryRun?: boolean;
			force?: boolean;
			timeout?: number;
			actionId?: string;
		} = {},
	): Promise<ActionResult> {
		const actionId =
			options.actionId || `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		debug("Executing action: %s with actionId: %s", actionName, actionId);

		try {
			this.communicationManager.registerAction(actionId, actionName, parameters);

			const registry = ActionRegistry.getInstance();
			const action = registry.get(actionName);

			if (!action) {
				const error = ErrorHandler.createActionNotFoundError(actionName);
				this.communicationManager.failAction(actionId, error.message);
				throw error;
			}

			const resolvedParams = await this.parameterResolver.resolveParameters(
				action.metadata,
				parameters,
			);
			this.communicationManager.updateActionState(actionId, {
				resolvedParameters: resolvedParams,
			});

			const executionContext: ActionContext = {
				variables: resolvedParams,
				projectRoot: context.projectRoot || process.cwd(),
				templatePath: context.templatePath,
				logger: context.logger || this.defaultLogger,
				utils: context.utils || this.defaultUtils,
				dryRun: options.dryRun || false,
				force: options.force || false,
				communication: {
					actionId,
					manager: this.communicationManager,
					sendMessage: (type: string, payload: any, target?: string) => {
						this.communicationManager.sendMessage({
							source: actionId,
							target,
							type,
							payload,
							timestamp: new Date(),
						});
					},
					getSharedData: (key: string) => this.communicationManager.getSharedData(key),
					setSharedData: (key: string, value: any) =>
						this.communicationManager.setSharedData(key, value, actionId),
					waitForAction: (targetActionId: string, timeout?: number) =>
						this.communicationManager.waitForAction(targetActionId, timeout),
					subscribeToMessages: (messageType: string, handler: (message: any) => void) =>
						this.communicationManager.subscribeToMessages(actionId, messageType, handler),
				},
			};

			if (options.dryRun) {
				const dryRunResult: ActionResult = {
					success: true,
					message: `[DRY RUN] Action '${actionName}' would execute with parameters: ${Object.keys(resolvedParams).join(", ")}`,
					filesCreated: [],
					filesModified: [],
					filesDeleted: [],
				};
				this.communicationManager.completeAction(actionId, dryRunResult);
				return dryRunResult;
			}

			const result = await action.fn(executionContext);

			this.communicationManager.completeAction(actionId, {
				filesCreated: result.filesCreated,
				message: result.message,
			});

			debug("Action %s completed", actionName);

			return result;
		} catch (error: any) {
			debug("Action execution failed: %s", error.message);
			this.communicationManager.failAction(actionId, error.message || "Action execution failed");

			if (error instanceof HypergenError) {
				throw error;
			}

			throw ErrorHandler.createError(
				ErrorCode.ACTION_EXECUTION_FAILED,
				error.message || "Action execution failed",
				{ action: actionName },
			);
		}
	}

	/**
	 * Execute an action with interactive parameter resolution
	 */
	async executeInteractively(
		actionName: string,
		parameters: Record<string, any> = {},
		context: Partial<ActionContext> = {},
		options: {
			useDefaults?: boolean;
			dryRun?: boolean;
			force?: boolean;
			skipOptional?: boolean;
			timeout?: number;
			actionId?: string;
		} = {},
	): Promise<ActionResult> {
		debug("Executing action interactively: %s with parameters: %o", actionName, parameters);

		// Generate action ID for communication tracking
		const actionId =
			options.actionId || `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		try {
			// Register action with communication manager
			this.communicationManager.registerAction(actionId, actionName, parameters);

			// Get action from registry
			const registry = ActionRegistry.getInstance();
			const action = registry.get(actionName);

			if (!action) {
				const error = ErrorHandler.createActionNotFoundError(actionName);
				this.communicationManager.failAction(actionId, error.message);
				throw error;
			}

			// Resolve parameters with interactive prompts
			const resolvedParams = await this.parameterResolver.resolveParametersInteractively(
				action.metadata,
				parameters,
				options,
			);

			// Update action state with resolved parameters
			this.communicationManager.updateActionState(actionId, {
				resolvedParameters: resolvedParams,
			});

			// Build execution context with communication support
			const executionContext: ActionContext = {
				variables: resolvedParams,
				projectRoot: context.projectRoot || process.cwd(),
				templatePath: context.templatePath,
				logger: context.logger || this.defaultLogger,
				utils: context.utils || this.defaultUtils,
				// Add execution options to context
				dryRun: options.dryRun || false,
				force: options.force || false,
				// Add communication capabilities
				communication: {
					actionId,
					manager: this.communicationManager,
					sendMessage: (type: string, payload: any, target?: string) => {
						this.communicationManager.sendMessage({
							source: actionId,
							target,
							type,
							payload,
							timestamp: new Date(),
						});
					},
					getSharedData: (key: string) => this.communicationManager.getSharedData(key),
					setSharedData: (key: string, value: any) =>
						this.communicationManager.setSharedData(key, value, actionId),
					waitForAction: (targetActionId: string, timeout?: number) =>
						this.communicationManager.waitForAction(targetActionId, timeout),
					subscribeToMessages: (messageType: string, handler: (message: any) => void) =>
						this.communicationManager.subscribeToMessages(actionId, messageType, handler),
				},
			};

			debug("Action context prepared for %s: %o", actionName, {
				variableCount: Object.keys(resolvedParams).length,
				projectRoot: executionContext.projectRoot,
				hasTemplatePath: !!executionContext.templatePath,
				dryRun: executionContext.dryRun,
				force: executionContext.force,
				actionId,
			});

			// Handle dry run
			if (options.dryRun) {
				debug("Dry run mode: simulating action execution");
				const dryRunResult = {
					success: true,
					message: `[DRY RUN] Action '${actionName}' would execute with parameters: ${Object.keys(resolvedParams).join(", ")}`,
					filesCreated: [],
					filesModified: [],
					filesDeleted: [],
				};
				this.communicationManager.completeAction(actionId, dryRunResult);
				return dryRunResult;
			}

			// Execute action
			const result = await action.fn(executionContext);

			// Complete action with communication manager
			this.communicationManager.completeAction(actionId, {
				filesCreated: result.filesCreated,
				message: result.message,
			});

			debug("Action %s completed", actionName);

			return result;
		} catch (error: any) {
			debug("Action execution with prompts failed: %s", error.message);

			// Fail action with communication manager
			this.communicationManager.failAction(actionId, error.message || "Action execution failed");

			if (error instanceof HypergenError) {
				throw error;
			}

			if (error instanceof ActionExecutionError) {
				throw ErrorHandler.createError(ErrorCode.ACTION_EXECUTION_FAILED, error.message, {
					action: actionName,
				});
			}

			throw ErrorHandler.createError(
				ErrorCode.ACTION_EXECUTION_FAILED,
				error.message || "Action execution failed",
				{ action: actionName },
			);
		}
	}

	/**
	 * Validate action parameters without executing
	 */
	async validateParameters(
		actionName: string,
		parameters: Record<string, any> = {},
	): Promise<{ valid: boolean; errors: string[] }> {
		try {
			const registry = ActionRegistry.getInstance();
			const action = registry.get(actionName);

			if (!action) {
				return {
					valid: false,
					errors: [`Action '${actionName}' not found`],
				};
			}

			await this.parameterResolver.resolveParameters(action.metadata, parameters);

			return { valid: true, errors: [] };
		} catch (error: any) {
			return {
				valid: false,
				errors: [error.message],
			};
		}
	}

	/**
	 * Get information about an action
	 */
	getActionInfo(actionName: string): {
		exists: boolean;
		metadata?: any;
		parameterCount?: number;
		requiredParameters?: string[];
	} {
		const registry = ActionRegistry.getInstance();
		const action = registry.get(actionName);

		if (!action) {
			return { exists: false };
		}

		const requiredParameters =
			action.metadata.parameters?.filter((p) => p.required).map((p) => p.name) || [];

		return {
			exists: true,
			metadata: action.metadata,
			parameterCount: action.metadata.parameters?.length || 0,
			requiredParameters,
		};
	}

	/**
	 * Get list of available action names
	 */
	getAvailableActionNames(): string[] {
		const registry = ActionRegistry.getInstance();
		return registry
			.getAll()
			.map((action) => action.metadata.name)
			.sort();
	}

	/**
	 * Get actions by category
	 */
	getActionsByCategory(category: string): string[] {
		const registry = ActionRegistry.getInstance();
		return registry
			.getByCategory(category)
			.map((action) => action.metadata.name)
			.sort();
	}

	/**
	 * Get all categories
	 */
	getCategories(): string[] {
		const registry = ActionRegistry.getInstance();
		return registry.getCategories();
	}

	/**
	 * Search actions by name or description
	 */
	searchActions(query: string): string[] {
		const registry = ActionRegistry.getInstance();
		const results = registry.query({ search: query });
		return results.map((action) => action.metadata.name).sort();
	}

	/**
	 * Get communication manager instance
	 */
	getCommunicationManager(): ActionCommunicationManager {
		return this.communicationManager;
	}

	/**
	 * Get workflow status and statistics
	 */
	getWorkflowStatus(): {
		activeActions: number;
		completedActions: number;
		failedActions: number;
		totalMessages: number;
		sharedDataEntries: number;
	} {
		return this.communicationManager.getStats();
	}

	/**
	 * Clear communication state
	 */
	clearCommunicationState(): void {
		this.communicationManager.clear();
	}
}
