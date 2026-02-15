/**
 * Common Types
 *
 * Shared types used across Hypergen
 *
 * Note: Logger class is exported from ../logger/index.js
 * ExtendedLogger type interface is available from ../logger/types.js
 */

import type { ExtendedLogger } from "#/logger/types.js";

export interface Prompter<Q, T> {
	prompt: (arg0: Q) => Promise<T>;
}

export interface RenderedAction {
	file?: string;
	attributes: any;
	body: string;
}

export interface RunnerConfig {
	exec?: (sh: string, body: string) => void;
	cwd?: string;
	logger?: ExtendedLogger;
	createPrompter?: <Q, T>() => Prompter<Q, T>;
}
