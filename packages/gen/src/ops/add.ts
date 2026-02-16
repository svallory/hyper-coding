import path from "node:path";
import * as p from "@clack/prompts";
import type { ActionResult, RenderedAction, RunnerConfig } from "@hypercli/core";
import fs from "fs-extra";
import { formatDiff } from "../utils/diff.js";
import { showInPager } from "../utils/pager.js";
import createResult from "./result.js";

const add = async (
	action: RenderedAction,
	args: Record<string, any>,
	{ logger, cwd = process.cwd() }: RunnerConfig,
): Promise<ActionResult> => {
	const {
		attributes: { to, inject, unless_exists, force, from, skip_if },
	} = action;
	const result = createResult("add", to ?? "unknown");
	if (inject) {
		return result("ignored");
	}
	if (!to) {
		return result('missing "to" attribute');
	}

	const absTo = path.resolve(cwd, to);
	const shouldNotOverwrite = !force && unless_exists !== undefined && unless_exists === true;
	const fileExists = await fs.pathExists(absTo);

	if (shouldNotOverwrite && fileExists) {
		logger?.warn(`     skipped: ${to}`);
		return result("skipped");
	}

	if (!process.env.HYPERGEN_OVERWRITE && fileExists && !force) {
		const existingContent = await fs.readFile(absTo, "utf-8");
		const resolution = await promptFileConflict(to, existingContent, action.body);

		if (resolution === "skip") {
			logger?.warn(`     skipped: ${to}`);
			return result("skipped");
		}
		if (resolution === "abort") {
			return result("aborted");
		}
		// resolution === "overwrite" — fall through to write
	}

	const shouldSkip = skip_if === true || skip_if === "true";

	if (shouldSkip) {
		return result("skipped");
	}

	if (from) {
		const from_path = path.join(args.templates, from);
		const file = fs.readFileSync(from_path).toString();
		action.body = file;
	}

	if (!args.dry) {
		await fs.ensureDir(path.dirname(absTo));
		await fs.writeFile(absTo, action.body);
	}
	const pathToLog = process.env.HYPERGEN_OUTPUT_ABS_PATH ? absTo : to;
	logger?.ok(`       ${force ? "FORCED" : "added"}: ${pathToLog}`);

	return result("added");
};

async function promptFileConflict(
	filePath: string,
	existingContent: string,
	newContent: string,
): Promise<"overwrite" | "skip" | "abort"> {
	const diff = formatDiff(existingContent, newContent, {
		oldLabel: filePath,
		newLabel: `${filePath} (incoming)`,
	});

	while (true) {
		p.log.warn(`File already exists: ${filePath}`);

		const action = await p.select({
			message: "What do you want to do?",
			options: [
				{ value: "diff" as const, label: "View diff" },
				{ value: "overwrite" as const, label: "Overwrite" },
				{ value: "skip" as const, label: "Skip this file" },
				{ value: "abort" as const, label: "Abort generation" },
			],
		});

		if (p.isCancel(action)) {
			p.cancel("Generation cancelled.");
			return "abort";
		}

		if (action === "diff") {
			await showInPager(diff);
			continue;
		}

		return action;
	}
}

export default add;
