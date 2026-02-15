export interface Logger {
	ok: (msg: string) => void;
	notice: (msg: string) => void;
	warn: (msg: string) => void;
	err: (msg: string) => void;
	log: (msg: string) => void;
	colorful: (msg: string) => void;
}

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
	logger?: Logger;
	createPrompter?: <Q, T>() => Prompter<Q, T>;
}

export type ActionResult = any;
