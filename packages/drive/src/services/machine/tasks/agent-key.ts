/**
 * Which public key the agent will be reachable with.
 *
 * The rootless-Docker step runs `ssh <agent>@<machine>`, and that only works if
 * the agent's `authorized_keys` holds a key the caller actually has the private
 * half of. Which key that is cannot be discovered from the machine — the setup
 * connection may use a key file, a key agent, a hardware token or a password —
 * so it is asked for, in this order:
 *
 * 1. `hyper machine setup --agent-key <file>` for this run;
 * 2. `machines.<name>.agent_key` in `drive.toml`;
 * 3. this machine's default public key, `~/.ssh/id_ed25519.pub`.
 *
 * Option 3 is what a one-key workstation does, and it is why the file that was
 * read is NAMED in the output: the user has to know that the key the agent will
 * accept is the one on their laptop.
 *
 * NOTHING PRIVATE IS EVER READ. The path must end in `.pub`, and the content
 * must be a single ssh public-key line — so a path pointing at `id_ed25519`
 * (the private half) or an `-----BEGIN … PRIVATE KEY-----` file is refused with
 * a message instead of being copied into a root script.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "#services/remote";
import type { TaskContext } from "./types.js";

/**
 * The key types an OpenSSH server accepts in `authorized_keys`.
 *
 * Deliberately an allowlist rather than "anything that parses": this string is
 * interpolated into a root script, and a narrow shape is a narrow thing to
 * refuse.
 */
export const PUBLIC_KEY_LINE =
	/^(ssh-ed25519|ssh-rsa|ssh-ed25519-cert-v01@openssh\.com|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]{16,}={0,3})(?: ([A-Za-z0-9._@-]{1,64}))?$/;

/** The public key hyperdrive falls back to when nothing else names one. */
export const DEFAULT_PUBLIC_KEY_FILE = "id_ed25519.pub";

export class AgentKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentKeyError";
	}
}

/**
 * One public key line, or a refusal.
 *
 * The comment is kept only when it is boring: a comment is free text, and free
 * text that lands in a root script is free text that has to be quoted. A comment
 * with anything unusual in it is dropped rather than escaped — the key itself is
 * all that authenticates anything.
 */
export function normalizePublicKey(raw: string, source: string): string {
	// A private key is refused on its first line, before anything else is said
	// about the file: that is the mistake worth naming precisely.
	if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) {
		throw new AgentKeyError(
			`${source} looks like a PRIVATE key. hyperdrive never reads, copies or installs a private key — point \`--agent-key\` at the \`.pub\` half instead (${source.replace(/\.pub$/, "")}.pub).`,
		);
	}
	const lines = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
	if (lines.length !== 1) {
		throw new AgentKeyError(
			`${source} holds ${lines.length} key lines; an \`authorized_keys\` entry hyper writes is exactly one public key. Point \`--agent-key\` at a single \`.pub\` file, or leave it out to use this machine's ${DEFAULT_PUBLIC_KEY_FILE}.`,
		);
	}
	const parts = lines[0].split(/\s+/);
	const [, kind, body] = PUBLIC_KEY_LINE.exec(`${parts[0]} ${parts[1] ?? ""}`) ?? [];
	if (kind === undefined || body === undefined) {
		throw new AgentKeyError(
			`${source} does not hold an ssh public key line (it starts ${JSON.stringify(lines[0].slice(0, 24))}). hyper installs the PUBLIC half only.`,
		);
	}
	// The comment is kept only when it is boring: it is free text, and free text
	// that lands in a root script is free text that has to be quoted. An awkward
	// comment is dropped rather than escaped — the key itself is what
	// authenticates anything.
	const comment = (parts[2] ?? "").match(/^[A-Za-z0-9._@-]{1,64}$/)?.[0];
	return comment === undefined ? `${kind} ${body}` : `${kind} ${body} ${comment}`;
}

/** Read one `.pub` file and return the key, refusing anything that is not one. */
export function readPublicKeyFile(path: string): string {
	if (!path.endsWith(".pub")) {
		throw new AgentKeyError(
			`${path} is not a public key file. hyperdrive never reads a private key: point \`--agent-key\` at ${path}.pub (or any other \`.pub\` file).`,
		);
	}
	let content: string;
	try {
		content = readFileSync(path, "utf-8");
	} catch (err) {
		throw new AgentKeyError(
			`I couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return normalizePublicKey(content, path);
}

/** The key, and which file it came from — so the run can say so out loud. */
export interface ResolvedAgentKey {
	/** A single public key line, safe to interpolate into a script. */
	key: string;
	/** Where it was read from, for the log line. */
	source: string;
}

/**
 * The key the agent should accept, from the flag, the config, or this machine's
 * own default public key.
 */
export function resolveAgentKey(ctx: TaskContext): ResolvedAgentKey {
	const flag = ctx.agentKeyFile;
	if (flag !== undefined && flag !== "") return { key: readPublicKeyFile(flag), source: flag };
	const name = ctx.machine?.name ?? ctx.config.self.name;
	const configured = ctx.machine?.agentKey ?? ctx.config.machines[name]?.agent_key ?? "";
	if (configured !== "") {
		try {
			return { key: readPublicKeyFile(configured), source: configured };
		} catch (err) {
			// A config value that points nowhere is a config problem, so the message
			// names the config key as well as the flag that would override it.
			throw new AgentKeyError(
				`${err instanceof Error ? err.message : String(err)}\`agent_key\` for ${ctx.machine?.name ?? "this machine"} is ${configured}; fix it in your hyperdrive config, or pass \`--agent-key <file>.pub\` for this run.`,
			);
		}
	}
	const fallback = join(homedir(), ".ssh", DEFAULT_PUBLIC_KEY_FILE);
	try {
		return { key: readPublicKeyFile(fallback), source: fallback };
	} catch (err) {
		throw new AgentKeyError(
			`I don't know which public key to give the agent user on ${ctx.machine?.name ?? "this machine"}. I looked for ${fallback} and it isn't there (${err instanceof Error ? err.message : String(err)}). Tell me which one to use: \`hyper machine setup ${ctx.machine?.name ?? "<machine>"} --features docker-rootless --agent-key <file>.pub\`, or set \`agent_key\` for that machine in your hyperdrive config. Only the \`.pub\` half is ever read.`,
		);
	}
}

/** The key as one shell word, for a generated script. */
export function quoteKey(key: string): string {
	return shellQuote(key);
}
