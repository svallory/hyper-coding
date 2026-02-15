import chalk from "chalk";
import type { ActionLogger } from "#/actions/types.js";

// chalk 4.1.2 doesn't type template property
const { yellow, red, green, magenta, gray, blue, template }: any = chalk;

class Logger implements ActionLogger {
	log: (message?: any, ...optionalParams: any[]) => void;

	constructor(log) {
		this.log = log;
	}

	colorful(msg) {
		this.log(template(chalk, msg));
	}

	info(msg) {
		this.log(blue(msg));
	}

	notice(msg) {
		this.log(magenta(msg));
	}

	warn(msg) {
		this.log(yellow(msg));
	}

	error(msg) {
		this.log(red(msg));
	}

	err(msg) {
		this.error(msg);
	}

	ok(msg) {
		this.log(green(msg));
	}

	debug(msg) {
		this.log(gray(msg));
	}

	trace(msg) {
		this.log(gray(msg));
	}
}
export default Logger;
