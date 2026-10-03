import { homedir } from "node:os";

export type SyncCadence = "" | "manual" | "session-end" | "session-end+push";

export interface SelfConfig {
	/** This machine's name. */
	name: string;
	/** This machine's home dir (default: os.homedir()). */
	home: string;
}

export interface DefaultsConfig {
	/** When spaces sync to the hyperdrive: manual, on session end, or on session end plus push. */
	cadence: SyncCadence;
}

export interface MachineConfig {
	/** Home dir on that machine. */
	home: string;
	/** Features available on that machine. */
	features: string[];
	/** User agents run as on that machine. */
	agent_user: string;
}

export interface WarpConfig {
	/** Directory names excluded when warping a session between machines. */
	exclude: string[];
}

export interface SyncTargetConfig {
	/** Extra ignore patterns for this sync target. */
	ignore: string[];
}

export interface SyncConfig {
	claude: SyncTargetConfig;
	pi: SyncTargetConfig;
}

export interface DriveConfig {
	/** Git URL of the user's hyperdrive repo. */
	remote: string;
	self: SelfConfig;
	defaults: DefaultsConfig;
	machines: Record<string, MachineConfig>;
	warp: WarpConfig;
	sync: SyncConfig;
}

export const DEFAULT_MACHINE: MachineConfig = {
	home: "",
	features: [],
	agent_user: "agent",
};

/* ------------------------------------------------------------------------- */
/* Manifest — spaces.yaml on `main` of the hyperdrive repository (design.md  */
/* "Data Model"). Owned by services/manifest.ts.                             */
/* ------------------------------------------------------------------------- */

/** One project repository of a space. `slug` is set only in a multi space. */
export interface SpaceRepo {
	url: string;
	default_branch: string;
	slug?: string;
}

/** One space, as recorded in the hyperdrive manifest. */
export interface SpaceEntry {
	name: string;
	branch: string;
	group: string | null;
	path: string;
	layout: "bare" | "multi";
	repos: SpaceRepo[];
	cadence: SyncCadence;
	/** Extra allowlist entries beyond the packaged defaults. */
	tracked: string[];
	/** Visibility axis; unused in phase one. */
	public: string[];
}

/** The whole of `spaces.yaml`. */
export interface Manifest {
	spaces: SpaceEntry[];
}

export const EMPTY_MANIFEST: Manifest = { spaces: [] };

const SPACE_LAYOUTS: readonly SpaceEntry["layout"][] = ["bare", "multi"];

// Same list as ALLOWED_CADENCES in config/index.ts, kept local so schema.ts
// stays import-free (index.ts already imports the types from here).
const MANIFEST_CADENCES: readonly SyncCadence[] = ["", "manual", "session-end", "session-end+push"];

/**
 * The shape a space name (and a group) may take: starts with a letter or
 * digit, then lowercase letters, digits, dots, underscores and dashes, and
 * never `..`. It doubles as a path segment and half of a branch name, so it
 * must be boring by construction — `/`, `\` and control characters can never
 * reach the filesystem or `git check-ref-format`.
 */
export const SPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isValidSpaceName(name: string): boolean {
	return SPACE_NAME_PATTERN.test(name) && !name.includes("..");
}

/** Keys a SpaceEntry is allowed to carry, in the order they are written. */
export const SPACE_ENTRY_KEYS = [
	"name",
	"branch",
	"group",
	"path",
	"layout",
	"repos",
	"cadence",
	"tracked",
	"public",
] as const;

const SPACE_REPO_KEYS = ["url", "default_branch", "slug"] as const;

/**
 * Friendly manifest problem, in the style of ConfigError: one sentence naming
 * the file and the offending key. Commands render it without a stack trace.
 */
export class ManifestError extends Error {
	constructor(path: string, detail: string) {
		super(`There's a problem with the hyperdrive manifest at ${path}: ${detail}`);
		this.name = "ManifestError";
	}
}

function manifestProblem(path: string, detail: string): ManifestError {
	return new ManifestError(path, detail);
}

function describeYaml(value: unknown): string {
	if (Array.isArray(value)) return "a list";
	if (value === null) return "null";
	return `a ${typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function needString(path: string, key: string, value: unknown): string {
	if (typeof value !== "string") {
		throw manifestProblem(path, `\`${key}\` must be a string, but it is ${describeYaml(value)}.`);
	}
	return value;
}

function needStringList(path: string, key: string, value: unknown): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw manifestProblem(path, `\`${key}\` must be a list of strings.`);
	}
	return value;
}

function warnUnknown(
	path: string,
	scope: string,
	raw: Record<string, unknown>,
	known: readonly string[],
): void {
	for (const key of Object.keys(raw)) {
		if (!known.includes(key)) {
			process.stderr.write(
				`warning: ignoring unknown key \`${scope}${key}\` in the hyperdrive manifest at ${path}\n`,
			);
		}
	}
}

function validateRepo(path: string, index: number, raw: unknown): SpaceRepo {
	if (!isRecord(raw)) {
		throw manifestProblem(
			path,
			`\`repos[${index}]\` must be a map, but it is ${describeYaml(raw)}.`,
		);
	}
	warnUnknown(path, `repos[${index}].`, raw, SPACE_REPO_KEYS);
	const repo: SpaceRepo = {
		url: needString(path, `repos[${index}].url`, raw.url),
		default_branch: needString(path, `repos[${index}].default_branch`, raw.default_branch),
	};
	if (raw.slug !== undefined) {
		repo.slug = needString(path, `repos[${index}].slug`, raw.slug);
	}
	return repo;
}

function validateSpace(path: string, raw: unknown): SpaceEntry {
	if (!isRecord(raw)) {
		throw manifestProblem(
			path,
			`every entry of \`spaces\` must be a map, but one is ${describeYaml(raw)}.`,
		);
	}
	warnUnknown(path, "", raw, SPACE_ENTRY_KEYS);

	const name = needString(path, "name", raw.name);
	if (!isValidSpaceName(name)) {
		throw manifestProblem(
			path,
			`\`name\` must be a space name — lowercase letters, digits, dots, underscores and ` +
				`dashes, no "..", and the manifest entry for ${JSON.stringify(name)} breaks that.`,
		);
	}
	const key = (field: string) => `spaces entry ${JSON.stringify(name)}: \`${field}\``;

	if (typeof raw.group === "string" && !isValidSpaceName(raw.group)) {
		throw manifestProblem(
			path,
			`\`group\` must be a space name (same shape as \`name\`), but it is ${JSON.stringify(raw.group)}.`,
		);
	}
	if (raw.group !== null && typeof raw.group !== "string") {
		throw manifestProblem(
			path,
			`${key("group")} must be a string or null, but it is ${describeYaml(raw.group)}.`,
		);
	}
	if (!SPACE_LAYOUTS.includes(raw.layout as SpaceEntry["layout"])) {
		throw manifestProblem(
			path,
			`${key("layout")} must be "bare" or "multi", but it is ${JSON.stringify(raw.layout)}.`,
		);
	}
	if (!Array.isArray(raw.repos)) {
		throw manifestProblem(
			path,
			`${key("repos")} must be a list, but it is ${describeYaml(raw.repos)}.`,
		);
	}
	if (!MANIFEST_CADENCES.includes(raw.cadence as SyncCadence)) {
		throw manifestProblem(
			path,
			`${key("cadence")} must be one of "manual", "session-end", "session-end+push" (or empty) — got ${JSON.stringify(raw.cadence)}.`,
		);
	}

	return {
		name,
		branch: needString(path, key("branch"), raw.branch),
		group: raw.group as string | null,
		path: needString(path, key("path"), raw.path),
		layout: raw.layout as SpaceEntry["layout"],
		repos: raw.repos.map((repo, index) => validateRepo(path, index, repo)),
		cadence: raw.cadence as SyncCadence,
		tracked: needStringList(path, key("tracked"), raw.tracked),
		public: needStringList(path, key("public"), raw.public),
	};
}

/**
 * Validate raw parsed YAML as a Manifest. Unknown keys warn on stderr and are
 * dropped; wrong types throw a ManifestError naming the key.
 */
export function validateManifest(path: string, raw: unknown): Manifest {
	if (!isRecord(raw)) {
		throw manifestProblem(path, `the top level must be a map, but it is ${describeYaml(raw)}.`);
	}
	warnUnknown(path, "", raw, ["spaces"]);
	if (!Array.isArray(raw.spaces)) {
		throw manifestProblem(
			path,
			`\`spaces\` must be a list, but it is ${describeYaml(raw.spaces)}.`,
		);
	}
	return { spaces: raw.spaces.map((entry) => validateSpace(path, entry)) };
}

export const DEFAULT_CONFIG: DriveConfig = {
	remote: "",
	self: {
		name: "",
		home: homedir(),
	},
	defaults: {
		cadence: "",
	},
	machines: {},
	warp: {
		exclude: ["node_modules", "_build", "deps", "target", "dist", ".turbo", ".cache", ".next"],
	},
	sync: {
		claude: { ignore: [] },
		pi: { ignore: [] },
	},
};
