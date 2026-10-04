import { isAbsolute, normalize } from "node:path";
import { isValidSpaceName, type SpaceEntry } from "#config/schema";
import { quoteForTerminal } from "#lib/terminal-text";
import { normaliseTrackedEntry } from "#services/allowlist";
import { checkProjectBranchName, redactGitSecrets } from "#services/space-git";

/** Never print embedded credentials from untrusted manifest data. */
export function redactCloneUrl(value: string): string {
	// One manifest value is one url, so its authority runs to the first `/`
	// even across whitespace: a malformed `user:pass with spaces@host` is
	// still a credential. Free text (git's stderr) cannot assume that, which
	// is why redactGitSecrets stops at whitespace.
	return redactGitSecrets(value.replace(/^(\s*[a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, "$1[redacted]@"));
}

/** Local test/development drives may reference local projects; hosted drives may not. */
export function isLocalDriveRemote(remote: string): boolean {
	if (remote.startsWith("file://")) {
		try {
			const url = new URL(remote);
			return !url.hostname || url.hostname === "localhost";
		} catch {
			return false;
		}
	}
	return (
		remote !== "" && !remote.startsWith("-") && !remote.includes(":") && !/[\0\r\n]/.test(remote)
	);
}

/**
 * Every one of these strings is printed back to a terminal — in an error, a
 * warning or the clone summary. C0, C1 and DEL would let a manifest colour the
 * screen, move the cursor, or set the window title.
 */
export function hasControlCharacters(value: string): boolean {
	// eslint-disable-next-line no-control-regex
	return /[\p{Cc}\p{Cf}]/u.test(value);
}

export function isAllowedProjectUrl(value: string, allowLocal: boolean): boolean {
	if (!value || value !== value.trim() || hasControlCharacters(value) || value.startsWith("-"))
		return false;
	if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
		try {
			const url = new URL(value);
			// Secrets in argv can also leak through inherited git progress output.
			if (url.password) return false;
			// A leading dash turns part of the authority into an option, not a
			// host: `ssh://-oProxyCommand=…@host` parses the payload as the
			// USERNAME, and `ssh user@host` would run it. Reject both spellings.
			if (url.username.startsWith("-") || url.hostname.startsWith("-")) return false;
			if (url.protocol === "https:" || url.protocol === "ssh:") return !!url.hostname;
			return (
				allowLocal && url.protocol === "file:" && (!url.hostname || url.hostname === "localhost")
			);
		} catch {
			return false;
		}
	}
	// scp-like `user@host:path`: the host is what sits between @ and the colon.
	const scp = /^[\w.+-]+@([^:/\s]+):.+$/.exec(value);
	if (scp && !value.includes("::")) return !scp[1].startsWith("-");
	return allowLocal && !value.includes(":");
}

/** Complete selected-entry validation, before any space/project creation or fetch. */
export function validateCloneEntry(entry: SpaceEntry, remote: string): void {
	const fail = (field: string, detail: string): never => {
		// The detail is often a whole sentence ending in its own period.
		const sentence = /[.!?]$/.test(detail.trim()) ? detail.trim() : `${detail}.`;
		throw new Error(
			`Invalid manifest field ${field}: ${sentence} Repair the manifest before cloning.`,
		);
	};
	if (typeof entry.name !== "string" || !isValidSpaceName(entry.name))
		fail("name", "expected a safe space name");
	if (entry.group !== null && (typeof entry.group !== "string" || !isValidSpaceName(entry.group)))
		fail("group", "expected null or a safe group name");
	// Names, groups, paths, slugs, branches and tracked entries are all echoed
	// to the user; none may carry terminal control characters.
	for (const [field, value] of [
		["name", entry.name],
		["group", entry.group],
		["branch", entry.branch],
		["path", entry.path],
	] as const) {
		if (typeof value === "string" && hasControlCharacters(value))
			fail(field, "contains terminal control characters");
	}
	const branch =
		entry.group === null ? `space/${entry.name}` : `space/${entry.group}/${entry.name}`;
	if (entry.branch !== branch) fail("branch", `expected ${branch}`);
	if (entry.layout !== "bare" && entry.layout !== "multi") fail("layout", "expected bare or multi");
	if (!["", "manual", "session-end", "session-end+push"].includes(entry.cadence))
		fail("cadence", "unknown cadence");
	if (
		typeof entry.path !== "string" ||
		!isAbsolute(entry.path) ||
		normalize(entry.path) !== entry.path ||
		/[\0\r\n]/.test(entry.path) ||
		entry.path.split("/").includes("..")
	)
		fail("path", "expected a normalized absolute path without control characters or traversal");
	if (!Array.isArray(entry.tracked)) fail("tracked", "expected a list");
	for (const [index, value] of entry.tracked.entries()) {
		try {
			if (typeof value !== "string") throw new Error("expected a directory name");
			if (hasControlCharacters(value)) throw new Error("contains terminal control characters");
			normaliseTrackedEntry(value);
		} catch (error) {
			fail(`tracked[${index}]`, error instanceof Error ? error.message : "invalid directory");
		}
	}
	if (
		!Array.isArray(entry.public) ||
		entry.public.some((value) => typeof value !== "string" || hasControlCharacters(value))
	)
		fail("public", "expected a list of paths without control characters");
	if (!Array.isArray(entry.repos) || (entry.layout === "bare" && entry.repos.length > 1))
		fail("repos", "expected a list, with at most one project for a bare space");
	const slugs = new Set<string>();
	for (const [index, repo] of entry.repos.entries()) {
		if (!repo || typeof repo !== "object") fail(`repos[${index}]`, "expected a repository map");
		if (entry.layout === "multi" || repo.slug !== undefined) {
			if (
				typeof repo.slug !== "string" ||
				!isValidSpaceName(repo.slug) ||
				hasControlCharacters(repo.slug) ||
				slugs.has(repo.slug.toLowerCase())
			)
				fail(`repos[${index}].slug`, "missing, unsafe or duplicate slug");
			if (typeof repo.slug === "string") slugs.add(repo.slug.toLowerCase());
		}
		if (
			typeof repo.url !== "string" ||
			(repo.url !== "" && !isAllowedProjectUrl(repo.url, isLocalDriveRemote(remote)))
		)
			fail(
				`repos[${index}].url`,
				// `JSON.stringify` escapes C0 only, so U+009B, U+202E and DEL
				// would be printed raw by the very message refusing them.
				`unsupported URL ${quoteForTerminal(redactCloneUrl(String(repo.url)))}; use HTTPS or SSH without an embedded password (local paths require a local hyperdrive)`,
			);
		if (
			typeof repo.default_branch !== "string" ||
			!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(repo.default_branch) ||
			repo.default_branch.includes("..") ||
			!checkProjectBranchName(repo.default_branch)
		)
			fail(
				`repos[${index}].default_branch`,
				"expected a safe git branch name containing only letters, digits, dots, underscores, slashes and dashes",
			);
	}
}
