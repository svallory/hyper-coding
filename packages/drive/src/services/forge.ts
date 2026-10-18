/**
 * The code forge behind a hyperdrive remote: GitHub or GitLab, found through
 * the CLI the user already logged in with (`gh`, `glab`).
 *
 * Four jobs, all best effort and all optional:
 * - detect the logged-in user and the git protocol their CLI is set to, so
 *   `hyper drive setup` can offer `git@github.com:<user>/hyperdrive.git` (or
 *   its https form) as the default remote;
 * - expand the shorthands people type (`you/hyperdrive`, or just
 *   `hyperdrive`) into a full URL on that forge;
 * - ask the forge whether a repository exists, so an unreachable remote is
 *   not mistaken for a missing one;
 * - create the repository when the forge says it does not exist yet.
 *
 * Nothing here runs without the user asking: detection is two read-only CLI
 * calls (`api user`, `config get`) with a short timeout, and creation only
 * happens after a confirmation or `--create`.
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

export type Provider = "github" | "gitlab";

/** Which CLI serves which forge. */
export const FORGE_CLI: Record<Provider, "gh" | "glab"> = {
	github: "gh",
	gitlab: "glab",
};

export interface Forge {
	provider: Provider;
	/** The host the CLI is logged in to, e.g. `github.com`. */
	host: string;
	/** The logged-in account. */
	user: string;
	/** True when the CLI is configured for HTTPS git URLs; SSH URLs when it does not say. */
	https?: boolean;
}

export interface ForgeRepo {
	provider: Provider;
	host: string;
	owner: string;
	name: string;
}

/** The default host of each forge, overridable the way its CLI does it. */
function defaultHost(provider: Provider): string {
	if (provider === "github") return process.env.GH_HOST?.trim() || "github.com";
	return process.env.GITLAB_HOST?.trim() || "gitlab.com";
}

/** Milliseconds a read-only CLI call may take before it is killed and treated as absent. */
const CLI_TIMEOUT_MS = 5000;

/** Creating a repository is a write over the network: give it room. */
const CREATE_TIMEOUT_MS = 60_000;

interface CliResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	/** True when the binary itself was not found. */
	missing: boolean;
	/** True when the call was killed for running past its timeout. */
	timedOut: boolean;
	/** The spawn error (not found, timeout, ...), when there was one. */
	error: string | null;
}

/**
 * Run a forge CLI from a neutral directory: setup never touches the current
 * directory, so no flag a CLI grows may be able to either.
 */
function runCli(
	bin: string,
	args: string[],
	options: { timeoutMs?: number; env?: Record<string, string> } = {},
): CliResult {
	const result = spawnSync(bin, args, {
		encoding: "utf8",
		timeout: options.timeoutMs ?? CLI_TIMEOUT_MS,
		cwd: tmpdir(),
		env: {
			...process.env,
			...options.env,
			GIT_TERMINAL_PROMPT: "0",
			GH_PROMPT_DISABLED: "1",
			GLAB_PROMPT_DISABLED: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
	return {
		ok: result.status === 0 && !result.error,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		missing: code === "ENOENT",
		timedOut: code === "ETIMEDOUT",
		error: result.error?.message ?? null,
	};
}

/** True when the CLI for this forge is on PATH. */
export function hasForgeCli(provider: Provider): boolean {
	return !runCli(FORGE_CLI[provider], ["--version"]).missing;
}

function loginFrom(provider: Provider, json: string): string | null {
	try {
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== "object" || parsed === null) return null;
		const key = provider === "github" ? "login" : "username";
		const value = (parsed as Record<string, unknown>)[key];
		return typeof value === "string" && /^[\w.-]+$/.test(value) ? value : null;
	} catch {
		return null;
	}
}

/** The git protocol the CLI is configured for on this host; SSH when it does not say. */
function prefersHttps(provider: Provider, host: string): boolean {
	const result = runCli(FORGE_CLI[provider], ["config", "get", "git_protocol", "-h", host]);
	return result.ok && result.stdout.trim().toLowerCase() === "https";
}

/**
 * The forge the user is logged in to, GitHub first. Null when neither CLI is
 * installed, logged in, or reachable within the timeout — setup then simply
 * offers no default remote.
 */
export function detectForge(): Forge | null {
	for (const provider of ["github", "gitlab"] as const) {
		const result = runCli(FORGE_CLI[provider], ["api", "user"]);
		if (!result.ok) continue;
		const user = loginFrom(provider, result.stdout);
		if (user) {
			const host = defaultHost(provider);
			return { provider, host, user, https: prefersHttps(provider, host) };
		}
	}
	return null;
}

const SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SHORTHAND = new RegExp(`^(?:(${SEGMENT})/)?(${SEGMENT})$`);

/** `owner/name` or a bare `name`, as people type them; null for URLs, paths and anything else. */
function shorthand(input: string): { owner: string | undefined; name: string } | null {
	const value = input.trim();
	if (value === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes(":")) return null;
	if (/^[/.~]/.test(value) || value.includes("\\")) return null;
	const match = SHORTHAND.exec(value);
	if (!match) return null;
	return { owner: match[1], name: match[2].replace(/\.git$/, "") };
}

/** True when expanding this remote needs to know the forge (a bare name or `owner/name`). */
export function isShorthand(input: string): boolean {
	return shorthand(input) !== null;
}

/** True for a bare `name` with no owner: it cannot be expanded without a logged-in user. */
export function isBareName(input: string): boolean {
	const parts = shorthand(input);
	return parts !== null && parts.owner === undefined;
}

/**
 * Expand `owner/name` or a bare `name` into a URL on the forge, over the
 * protocol the forge CLI is configured for (SSH when unknown). A value that
 * is already a URL or a path (has a scheme, a colon, or a leading `/`, `.` or
 * `~`) is returned unchanged. A bare name needs a detected user to fill the
 * owner; without one it is returned unchanged (callers check `isBareName`).
 */
export function expandRemote(input: string, forge: Forge | null): string {
	const parts = shorthand(input);
	if (!parts) return input.trim();
	const owner = parts.owner ?? forge?.user;
	if (!owner) return input.trim();
	const host = forge?.host ?? defaultHost("github");
	return forge?.https
		? `https://${host}/${owner}/${parts.name}.git`
		: `git@${host}:${owner}/${parts.name}.git`;
}

/**
 * The repository a remote URL names on a known forge, or null for anything
 * else (a path, an unknown host, a URL shape git would still accept).
 */
export function parseForgeRemote(remote: string): ForgeRepo | null {
	const value = remote.trim();
	const ssh =
		/^(?:ssh:\/\/)?(?:git@)?([A-Za-z0-9.-]+)[:/]([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(
			value,
		);
	const https =
		/^https?:\/\/(?:[^@/]+@)?([A-Za-z0-9.-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(
			value,
		);
	const match = https ?? ssh;
	if (!match) return null;
	const [, host, owner, name] = match;
	const provider = providerFor(host);
	if (!provider) return null;
	return { provider, host, owner, name };
}

function providerFor(host: string): Provider | null {
	const lower = host.toLowerCase();
	if (lower === defaultHost("github").toLowerCase() || lower === "github.com") return "github";
	if (lower === defaultHost("gitlab").toLowerCase() || lower === "gitlab.com") return "gitlab";
	return null;
}

/** `owner/name` on its host, for messages. */
export function describeRepo(repo: ForgeRepo): string {
	return `${repo.owner}/${repo.name} on ${repo.host}`;
}

/** Point the CLI at the remote's own host, not whichever host it defaults to. */
function hostEnv(repo: ForgeRepo): Record<string, string> {
	return repo.provider === "github" ? { GH_HOST: repo.host } : { GITLAB_HOST: repo.host };
}

/** The words gh (GraphQL, HTTP) and glab use for a repository that is not there. */
export function notFound(text: string): boolean {
	return /HTTP 404|404 (Project )?Not Found|Could not resolve to a Repository/i.test(text);
}

/**
 * Whether the forge knows the repository: `missing` only on a definite
 * not-found. Anything else (auth, network, timeout, an odd answer) is
 * `unknown`, which must never be read as permission to create.
 */
export function forgeRepoExists(repo: ForgeRepo): "exists" | "missing" | "unknown" {
	const result = runCli(FORGE_CLI[repo.provider], ["repo", "view", `${repo.owner}/${repo.name}`], {
		env: hostEnv(repo),
	});
	if (result.ok) return "exists";
	if (result.missing || result.timedOut) return "unknown";
	return notFound(`${result.stderr}\n${result.stdout}`) ? "missing" : "unknown";
}

/**
 * Create a private, empty repository through the forge's CLI, on the host
 * the remote names. glab gets `--skipGitInit`: by default it would set up a
 * local repository, which setup must never do.
 */
export function createForgeRepo(repo: ForgeRepo): { ok: boolean; message: string } {
	const bin = FORGE_CLI[repo.provider];
	const args =
		repo.provider === "github"
			? ["repo", "create", `${repo.owner}/${repo.name}`, "--private"]
			: ["repo", "create", repo.name, "--private", "--group", repo.owner, "--skipGitInit"];
	const result = runCli(bin, args, { timeoutMs: CREATE_TIMEOUT_MS, env: hostEnv(repo) });
	if (result.missing) {
		return {
			ok: false,
			message: `${bin} is not installed, so I can't create the repository for you.`,
		};
	}
	if (result.timedOut) {
		return {
			ok: false,
			message: `${bin} took longer than ${CREATE_TIMEOUT_MS / 1000} s to create the repository. It may exist by now: check ${describeRepo(repo)} before trying again.`,
		};
	}
	if (!result.ok) {
		const said =
			(result.stderr || result.stdout).trim().split("\n").filter(Boolean).join(" ").slice(0, 400) ||
			result.error ||
			"no output";
		return { ok: false, message: `${bin} could not create the repository: ${said}` };
	}
	return { ok: true, message: `Created private repository ${describeRepo(repo)}.` };
}
