/**
 * Logger adapter utilities
 */

import type { ActionLogger } from '../../actions/types.js';

/**
 * Create a logger adapter that forwards calls to the provided logger
 */
export function createLoggerAdapter(logger: ActionLogger): ActionLogger {
	return {
		info: (message: string) => void logger.info(message),
		warn: (message: string) => void logger.warn(message),
		error: (message: string) => void logger.error(message),
		debug: (message: string) => void logger.debug(message),
		trace: (message: string) => void logger.trace(message),
	};
}
