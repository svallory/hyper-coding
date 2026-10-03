import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cleanGitEnv, SpaceGitInterruptedError } from "#services/space-git";

const SPACE_TEMPLATE = "{{ repo_path }}/../worktrees/{{ branch | sanitize }}";
const DEFAULT_TEMPLATE = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}";
const PLACEMENT_DOC =
	"https://github.com/svallory/hyper-coding/blob/main/agent-plugin/commands/init.md";

interface PlacementConfig {
	"worktree-path"?: string;
	projects: Record<string, { "worktree-path": string }>;
}
interface WorktrunkResponse {
	result?: string;
	user: { path?: string; config: PlacementConfig };
	system: { config: PlacementConfig };
	project: { identifier?: string };
}

/** Worktrunk's read-only JSON commands; no switch, hooks, approvals or writes. */
function queryWorktrunk(root: string, args: string[]): WorktrunkResponse {
	const result = spawnSync("wt", ["-C", root, ...args], {
		encoding: "utf8",
		env: { ...cleanGitEnv(), NO_COLOR: "1", WORKTRUNK_VERBOSE: "0" },
		timeout: 10_000,
		// A hung optional query is not a terminal interruption: warn, don't
		// roll back a completed clone with exit 130 on the timeout's SIGTERM.
		killSignal: "SIGKILL",
	});
	if (result.signal === "SIGINT" || result.signal === "SIGTERM")
		throw new SpaceGitInterruptedError(result.signal);
	if (result.error || result.status !== 0)
		throw new Error(result.error?.message ?? result.stderr.trim());
	let raw: Record<string, unknown>;
	try {
		raw = record(JSON.parse(result.stdout));
	} catch {
		throw new Error("worktrunk returned invalid JSON while inspecting placement");
	}
	const decodeConfig = (value: unknown): PlacementConfig => {
		const config = record(value);
		const projects: PlacementConfig["projects"] = {};
		for (const [key, entry] of Object.entries(record(config.projects))) {
			const template = string(record(entry)["worktree-path"]);
			if (template !== undefined) projects[key] = { "worktree-path": template };
		}
		return { "worktree-path": string(config["worktree-path"]), projects };
	};
	return {
		result: string(raw.result),
		user: { path: string(record(raw.user).path), config: decodeConfig(record(raw.user).config) },
		system: { config: decodeConfig(record(raw.system).config) },
		project: { identifier: string(record(raw.project).identifier) },
	};
}

/** Decode only the fields this read-only integration consumes. */
function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function string(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Worktrunk project keys use '*' wildcards, least-specific first. */
function projectTemplate(config: PlacementConfig, identifier: string): string | undefined {
	const entries = Object.entries(config.projects)
		.filter(([key]) => {
			const pattern = key
				.split("*")
				.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join(".*");
			return new RegExp(`^${pattern}$`).test(identifier);
		})
		.sort(([a], [b]) => {
			if (!a.includes("*") && b.includes("*")) return 1;
			if (a.includes("*") && !b.includes("*")) return -1;
			return a.replaceAll("*", "").length - b.replaceAll("*", "").length;
		});
	let template: string | undefined;
	for (const [, entry] of entries) template = entry["worktree-path"];
	return template;
}

/**
 * Placement is a USER preference, not a setting clone may write. Worktrunk
 * supplies the config locations, project identifier and template evaluator;
 * clone only chooses its documented scalar override and compares destinations.
 * Missing/older wt or unreadable config yields advice, never a failed clone.
 */
export function spaceWorktrunkWarning(root: string): string | null {
	let configPath =
		process.env.WORKTRUNK_CONFIG_PATH ??
		join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "worktrunk", "config.toml");
	let identifier: string | undefined;
	const advice = (): string => {
		const setting = identifier
			? `[projects.${JSON.stringify(identifier)}]\nworktree-path = ${JSON.stringify(SPACE_TEMPLATE)}`
			: `worktree-path = ${JSON.stringify(SPACE_TEMPLATE)}`;
		const environment =
			process.env.WORKTRUNK_WORKTREE_PATH === undefined
				? ""
				: "Unset or update WORKTRUNK_WORKTREE_PATH first; it overrides the config file. ";
		return `${environment}Add or update this setting in ${configPath} (clone never edits user configuration):\n${setting}\nPlacement prerequisite: ${PLACEMENT_DOC}`;
	};
	try {
		const configuration = queryWorktrunk(root, ["config", "show", "--format", "json"]);
		const { config: userConfig } = configuration.user;
		const { config: systemConfig } = configuration.system;
		configPath = configuration.user.path ?? configPath;
		identifier = configuration.project.identifier;
		const combined: PlacementConfig = {
			"worktree-path": userConfig["worktree-path"] ?? systemConfig["worktree-path"],
			projects: { ...systemConfig.projects, ...userConfig.projects },
		};
		const template =
			process.env.WORKTRUNK_WORKTREE_PATH ??
			(identifier ? projectTemplate(combined, identifier) : undefined) ??
			combined["worktree-path"] ??
			DEFAULT_TEMPLATE;
		const evaluate = (text: string): string => {
			const output = queryWorktrunk(root, ["step", "eval", "--format", "json", text]);
			const path = output.result;
			if (!path) throw new Error("worktrunk did not return a template result");
			const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
			return resolve(root, ".git", expanded);
		};
		const actual = evaluate(template);
		const expected = evaluate(SPACE_TEMPLATE);
		if (actual === expected) return null;
		return `Worktrees for ${root} will be created at ${actual}, not ${expected}. ${advice()}`;
	} catch (error) {
		if (error instanceof SpaceGitInterruptedError) throw error;
		return `I couldn't verify worktrunk placement for ${root} (wt may be absent, too old, or its config unreadable). ${advice()}`;
	}
}
