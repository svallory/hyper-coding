/**
 * The code forge behind a hyperdrive remote: GitHub or GitLab, found through
 * the CLI the user already logged in with (`gh`, `glab`).
 *
 * Three jobs, all best effort and all optional:
 * - detect the logged-in user, so `hyper drive setup` can offer
 *   `git@github.com:<user>/hyperdrive.git` as the default remote;
 * - expand the shorthands people type (`you/hyperdrive`, or just
 *   `hyperdrive`) into a full SSH URL on that forge;
 * - create the repository when the remote does not exist yet.
 *
 * Nothing here runs without the user asking: detection is one read-only
 * `api user` call with a short timeout, and creation only happens after a
 * confirmation or `--create`.
 */

import { spawnSync } from "node:child_process";

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

/** Milliseconds a CLI call may take before it is killed and treated as absent. */
const CLI_TIMEOUT_MS = 5000;

interface CliResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	/** True when the binary itself was not found. */
	missing: boolean;
}

function runCli(bin: string, args: string[]): CliResult {
	const result = spawnSync(bin, args, {
		encoding: "utf8",
		timeout: CLI_TIMEOUT_MS,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GH_PROMPT_DISABLED: "1",
			GLAB_PROMPT_DISABLED: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const missing = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
	return {
		ok: result.status === 0 && !result.error,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		missing,
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
		if (user) return { provider, host: defaultHost(provider), user };
	}
	return null;
}

const SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SHORTHAND = new RegExp(`^(?:(${SEGMENT})/)?(${SEGMENT})$`);

/**
 * Expand `owner/name` or a bare `name` into an SSH URL on the forge. A value
 * that is already a URL or a path (has a scheme, a colon, or a leading `/`,
 * `.` or `~`) is returned unchanged. A bare name needs a detected user to
 * fill the owner; without one it is returned unchanged so git reports it.
 */
export function expandRemote(input: string, forge: Forge | null): string {
	const value = input.trim();
	if (value === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes(":")) return value;
	if (/^[/.~]/.test(value) || value.includes("\\")) return value;
	const match = SHORTHAND.exec(value);
	if (!match) return value;
	const owner = match[1] ?? forge?.user;
	if (!owner) return value;
	const name = match[2].replace(/\.git$/, "");
	const host = forge?.host ?? defaultHost("github");
	return `git@${host}:${owner}/${name}.git`;
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

/**
 * Create a private, empty repository through the forge's CLI. The CLI is
 * trusted to pick the host it is logged in to; a host mismatch comes back
 * as its own error text.
 */
export function createForgeRepo(repo: ForgeRepo): { ok: boolean; message: string } {
	const bin = FORGE_CLI[repo.provider];
	const args =
		repo.provider === "github"
			? ["repo", "create", `${repo.owner}/${repo.name}`, "--private"]
			: ["repo", "create", repo.name, "--private", "--group", repo.owner];
	const result = runCli(bin, args);
	if (result.missing) {
		return {
			ok: false,
			message: `${bin} is not installed, so I can't create the repository for you.`,
		};
	}
	if (!result.ok) {
		const said =
			(result.stderr || result.stdout).trim().split("\n").filter(Boolean).pop() ?? "no output";
		return { ok: false, message: `${bin} could not create the repository: ${said}` };
	}
	return { ok: true, message: `Created private repository ${describeRepo(repo)}.` };
}
