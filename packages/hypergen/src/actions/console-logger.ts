// src/actions/console-logger.ts
import type Logger from '../logger.js';
import type { ActionLogger } from './types.js';

export class ConsoleActionLogger implements ActionLogger {
	private logger: Logger;

	constructor(loggerInstance: Logger) {
		this.logger = loggerInstance;
	}

	info(message: string): void {
		this.logger.log(message);
	}

	warn(message: string): void {
		this.logger.warn(message);
	}

	error(message: string): void {
		this.logger.err(message);
	}

	debug(message: string): void {
		this.logger.log(`[DEBUG] ${message}`);
	}

	trace(message: string): void {
		this.logger.log(`[TRACE] ${message}`);
	}
}
