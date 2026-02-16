import path from "node:path";
import type { ActionResult, RenderedAction, RunnerConfig } from "@hypercli/core";
import fs from "fs-extra";
import injector from "./injector.js";
import createResult from "./result.js";

const injectOp = async (
	action: RenderedAction,
	args: any,
	{ logger, cwd = process.cwd() }: RunnerConfig,
): Promise<ActionResult> => {
	const {
		attributes: { to, inject },
	} = action;

	const result = createResult("inject", to ?? "unknown");

	if (!(inject && to)) {
		return result("ignored");
	}

	const absTo = path.resolve(cwd, to);

	if (!(await fs.exists(absTo))) {
		logger?.err(`Cannot inject to ${to}: doesn't exist.`);
		return result("error", {
			error: `Cannot inject to ${to}: doesn't exist.`,
		});
	}

	const content = (await fs.readFile(absTo)).toString();
	const injectResult = injector(action, content);

	if (!args.dry) {
		await fs.writeFile(absTo, injectResult);
	}
	const pathToLog = process.env.HYPERGEN_OUTPUT_ABS_PATH ? absTo : to;
	logger?.notice(`      inject: ${pathToLog}`);

	return result("inject");
};

export default injectOp;
