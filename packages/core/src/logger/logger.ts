import chalk from 'chalk';
import type { ExtendedLogger } from './types.js';

// chalk 4.1.2 doesn't type template property
const { yellow, red, green, magenta, gray, blue, template }: any = chalk;

class Logger implements ExtendedLogger {
	log: (message?: any, ...optionalParams: any[]) => void;

	constructor(log: (message?: any, ...optionalParams: any[]) => void) {
		this.log = log;
	}

	colorful(msg: string): void {
		this.log(template(chalk, msg));
	}

	info(msg: string): void {
		this.log(blue(msg));
	}

	notice(msg: string): void {
		this.log(magenta(msg));
	}

	warn(msg: string): void {
		this.log(yellow(msg));
	}

	error(msg: string): void {
		this.log(red(msg));
	}

	err(msg: string): void {
		this.error(msg);
	}

	ok(msg: string): void {
		this.log(green(msg));
	}

	debug(msg: string): void {
		this.log(gray(msg));
	}

	trace(msg: string): void {
		this.log(gray(msg));
	}
}
export default Logger;
