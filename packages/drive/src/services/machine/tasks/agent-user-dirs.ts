/**
 * `agent-user.dirs` — what the two users share.
 *
 * Runs as the primary user, with no root anywhere in it. Everything it needs was
 * made possible by `agent-user.create`: the `collab` group both users are in,
 * and an agent config dir the agent owns.
 *
 * THE RULE THIS TASK EXISTS TO KEEP: ACLs over the Claude config dir are never
 * applied recursively. `.credentials.json` is 0600 and must stay unreadable to
 * the second user — a named-group ACL on it would *grant* read, which is the
 * opposite of what a "shared config" task should do. So only `projects/` — which
 * holds transcripts and nothing else — is walked.
 *
 * AND THERE IS NO DEFAULT ACL ON THE CONFIG DIR. A default entry is inherited by
 * everything created there afterwards, so one on the config dir would hand the
 * agent read on every file Claude Code writes into it from then on: history,
 * debug logs, shell snapshots, lock files, and whatever credential file comes
 * next. The kernel also ignores umask once a default ACL exists, so the mode
 * would not even save us. Access is therefore granted per entry instead:
 * traverse on the dir itself, read on the two files worth sharing, and a default
 * entry only on skills/, commands/ and agents/, which hold no secrets.
 *
 * The symlinks into the agent's config dir are NOT made here. They live inside a
 * directory the agent controls, so they are made BY THE AGENT, from the root
 * script (`agent-user.create`). This task only verifies them.
 */

import { asAgentScript } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { type AgentPaths, agentHomeOf, agentPaths, agentUserOf, homeOf } from "./agent-context.js";
import { runOrFail, runScript, succeeds } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

/** The group both users share (must match `agent-user.create`). */
export const COLLAB_GROUP = "collab";

/**
 * The entries in the agent's config dir that are symlinks into the primary
 * user's, verified (not created) here.
 *
 * `projects` is the writable one — it is the shared transcripts dir, and it is a
 * real directory on the primary side, not a file. Everything else is read-only BY
 * DESIGN: sharing the config dir wholesale was rejected because `.claude.json`
 * holds MCP server commands (writable by both = an escalation path) and because
 * hooks, plugins and skills are the primary user's to change.
 */
const SYMLINKS: readonly { name: string }[] = [
	{ name: "projects" },
	{ name: "settings.json" },
	{ name: "CLAUDE.md" },
	{ name: "skills" },
	{ name: "commands" },
	{ name: "agents" },
];

/**
 * The entries in the PRIMARY user's config dir the agent may read, and how.
 *
 * `r--` on the two files: they are the settings the agent should honour and the
 * instructions it should follow. Recursive `rX` plus a default `rX` on the three
 * directories: they hold skills, commands and subagent definitions — the
 * operator's instructions for the agent — and no secrets.
 */
export const READABLE_FILES = ["settings.json", "CLAUDE.md"] as const;
export const READABLE_DIRS = ["skills", "commands", "agents"] as const;

/**
 * Top-level home entries the deny must NOT touch.
 *
 * The work dir (group-writable, it is the shared one) and the config dir (which
 * carries its own, finer-grained set of entries). Symlinks are excluded by TYPE
 * rather than by name — a top-level symlink is the one entry whose target is
 * outside the home, and setting an ACL on it would apply to that target.
 */
export const TOP_LEVEL_ALLOWED = ["work", ".claude"] as const;

/** Direct children of the config dir the deny must NOT touch, and why. */
export const CLAUDE_CHILDREN_ALLOWED = [
	"projects",
	"settings.json",
	"CLAUDE.md",
	"skills",
	"commands",
	"agents",
] as const;

/**
 * Filesystems that do not use the kernel's POSIX ACL check.
 *
 * The whole design rests on one kernel fact: when a process's group matches a
 * named group entry, access is decided there and never falls through to `other`.
 * NFSv4 with `acl`/`nolacl` differences, CIFS with its own ACL model, and FUSE
 * mounts can all silently not apply it — and a deny that is silently ignored is
 * worse than no deny, because the check would go on reporting the machine as
 * protected. So refuse these before changing anything.
 */
const UNSUPPORTED_FS = new Set(["nfs", "nfs4", "cifs", "smb3", "fuse", "fuseblk", "fuse.sshfs"]);

/** The two lines every user's shell gets, so shared files are group-accessible from birth. */
const BASHRC_LINES = ["umask 002", "set -o physical"] as const;

/**
 * The shell that lists, comma-separated, the direct children of `dir` that
 * should be denied to the shared group and are not.
 *
 * Symlinks are skipped by TYPE: an ACL on a symlink applies to its target, and
 * for a top-level symlink that target is outside the home, so denying there
 * would change something that is not the home's. The named exclusions are the
 * work dir and the shared entries, which carry their own grants — built from the
 * caller's constants rather than written out, so a rename cannot leave a literal
 * behind.
 */
function unprotectedUnder(dir: string, allowed: readonly string[]): string {
	const q = shellQuote;
	// ANDed, never `-o`. In find, `-o` binds looser than the implicit `-a`, so
	// `! -type l ! -name work -o ! -name .claude` means "(!symlink AND !work) OR
	// .claude" — which would deny the config dir itself, exactly the entry the
	// exclusion exists to protect. Every exclusion here is conjunctive.
	const skip = allowed.map((name) => `! -name ${q(name)}`).join(" ");
	return `$(find ${q(dir)} -mindepth 1 -maxdepth 1 ! -type l ${skip} -exec sh -c 'for p do getfacl -c -p "$p" 2>/dev/null | grep -q "^group:collab:---$" || printf "%s," "$p"; done' _ {} + 2>/dev/null || true)`;
}

/**
 * Deny the shared group access to every direct child of `dir` except the named
 * ones — one level only, never through a symlink.
 *
 * The same `find` the check uses to find what is unprotected, so "what setup
 * applies" and "what the check demands" cannot drift apart; only the action
 * differs. `! -type l` is not tidiness: an ACL on a symlink applies to its
 * target, and for a top-level symlink that target is outside the home.
 */
function denyDirectChildren(dir: string, allowed: readonly string[]): string {
	const q = shellQuote;
	// ANDed, never `-o`. In find, `-o` binds looser than the implicit `-a`, so
	// `! -type l ! -name work -o ! -name .claude` means "(!symlink AND !work) OR
	// .claude" — which would deny the config dir itself, exactly the entry the
	// exclusion exists to protect. Every exclusion here is conjunctive.
	const skip = allowed.map((name) => `! -name ${q(name)}`).join(" ");
	// Best-effort (one unwritable entry must not abort the rest) but NOT silent:
	// an entry this cannot deny is one the agent can read, and swallowing the
	// error turned that into "setup never settles" with nothing to act on.
	return `find ${q(dir)} -mindepth 1 -maxdepth 1 ! -type l ${skip} -exec setfacl -m g:${COLLAB_GROUP}:--- {} + 2>&1 || true`;
}

/**
 * Say out loud whatever the deny could not do.
 *
 * A denial that silently failed is the worst outcome here: the check keeps
 * reporting the machine as unfinished, the user re-runs, and nothing ever says
 * why. So the raw error is printed with the place it came from, which is almost
 * always "you don't own this one" — and that is actionable.
 */
function reportDenyFailures(ctx: TaskContext, where: string, result: { stdout: string }): void {
	const detail = (result.stdout ?? "").trim();
	if (detail === "") return;
	ctx.log(
		`agent-user.dirs: I could not deny everything under ${where}, so the agent may still be able to read some of it. What the system said: ${detail.split("\n").slice(0, 3).join(" | ")}`,
	);
}

/**
 * Everything the check asks the machine, as labelled `key=value` lines.
 *
 * The setgid questions use `test -g`, which tests the bit. They deliberately do
 * NOT parse `stat -c %a`: a setgid directory reports `2770`, so the setgid digit
 * is the FIRST of four — and the obvious "does the last digit end in 2367" test
 * reports every correctly set-up directory as NOT setgid.
 */
function probe(paths: AgentPaths, agentUser: string): string {
	const q = shellQuote;
	return [
		// The shared work dir: group, setgid, and the group entry.
		`printf 'work_group=%s\\n' "$(stat -c %G ${q(paths.work)} 2>/dev/null || echo missing)"`,
		`printf 'work_setgid=%s\\n' "$(test -g ${q(paths.work)} && echo yes || echo no)"`,
		`printf 'work_acl=%s\\n' "$(getfacl -c -p ${q(paths.work)} 2>/dev/null | grep -c '^group:collab:rwx' || echo 0)"`,
		`printf 'work_default_acl=%s\\n' "$(getfacl -c -p ${q(paths.work)} 2>/dev/null | grep -c '^default:group:collab:rwx' || echo 0)"`,
		// The home: traversable by the group (the agent must reach work/), and an
		// inherited DENY for everything created under it from now on.
		`printf 'home_acl=%s\\n' "$(getfacl -c -p ${q(paths.home)} 2>/dev/null | grep -c '^group:collab:--x' || echo 0)"`,
		`printf 'home_default_deny=%s\\n' "$(getfacl -c -p ${q(paths.home)} 2>/dev/null | grep -c '^default:group:collab:---' || echo 0)"`,
		// Which filesystem the home is on. The deny rests on the kernel's POSIX ACL
		// check, and NFS/CIFS/FUSE can silently not apply it — in which case a deny
		// that "passes" protects nothing.
		`printf 'home_fs=%s\\n' "$(stat -f -c %T ${q(paths.home)} 2>/dev/null || echo unknown)"`,
		// The two kernel settings: hardlink protection (so the agent cannot
		// hard-link to a file the primary owns but the agent may not read) and
		// TIOCSTI (so the agent cannot inject into the primary's terminal).
		`printf 'hardlinks=%s\\n' "$(cat /proc/sys/fs/protected_hardlinks 2>/dev/null || echo 0)"`,
		`printf 'tiocsti=%s\\n' "$(cat /proc/sys/dev/tty/legacy_tiocsti 2>/dev/null || echo 1)"`,
		// Every top-level entry that should be denied and is not, by name.
		`printf 'unprotected_top=%s\\n' "${unprotectedUnder(paths.home, TOP_LEVEL_ALLOWED)}"`,
		// …and the same for the config dir's direct children.
		`printf 'unprotected_claude=%s\\n' "${unprotectedUnder(paths.claude, CLAUDE_CHILDREN_ALLOWED)}"`,
		// The config dir: TRAVERSE ONLY, plus an inherited deny.
		`printf 'claude_acl=%s\\n' "$(getfacl -c -p ${q(paths.claude)} 2>/dev/null | grep -c '^group:collab:--x' || echo 0)"`,
		`printf 'claude_default_deny=%s\\n' "$(getfacl -c -p ${q(paths.claude)} 2>/dev/null | grep -c '^default:group:collab:---' || echo 0)"`,
		// Read access to the two shared files, and to the three shared dirs (which
		// also carry a default entry, so new files in them are readable).
		...READABLE_FILES.map(
			(name) =>
				`printf 'read_${name}=%s\\n' "$(getfacl -c -p ${q(`${paths.claude}/${name}`)} 2>/dev/null | grep -c '^group:collab:r--' || echo 0)"`,
		),
		...READABLE_DIRS.map(
			(name) =>
				`printf 'read_${name}=%s\\n' "$(getfacl -c -p ${q(`${paths.claude}/${name}`)} 2>/dev/null | grep -c '^group:collab:r-x' || echo 0)"`,
		),
		// projects/: group-writable and setgid.
		`printf 'projects_group=%s\\n' "$(stat -c %G ${q(paths.projects)} 2>/dev/null || echo missing)"`,
		`printf 'projects_setgid=%s\\n' "$(test -g ${q(paths.projects)} && echo yes || echo no)"`,
		`printf 'projects_acl=%s\\n' "$(getfacl -c -p ${q(paths.projects)} 2>/dev/null | grep -c '^group:collab:rwx' || echo 0)"`,
		// The agent's config dir, and each symlink's target.
		...SYMLINKS.map(
			(entry) =>
				`printf 'link_${entry.name}=%s\\n' "$(readlink ${q(`${paths.agentClaude}/${entry.name}`)} 2>/dev/null || echo missing)"`,
		),
		`printf 'as_agent=%s\\n' "$(test -x ${q(`${paths.bin}/as-agent`)} && echo yes || echo no)"`,
		`printf 'bashrc_umask=%s\\n' "$(grep -c '^umask 002$' ${q(`${paths.home}/.bashrc`)} 2>/dev/null || echo 0)"`,
		`printf 'bashrc_physical=%s\\n' "$(grep -c '^set -o physical$' ${q(`${paths.home}/.bashrc`)} 2>/dev/null || echo 0)"`,
		// Which user this all ran as, so a mistaken target is visible.
		`printf 'whoami=%s\\n' "$(id -un)"`,
		`printf 'agent_user=%s\\n' ${q(agentUser)}`,
	].join("; ");
}

function answers(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		// Values may contain `=` (paths don't, but a readlink target could), so the
		// FIRST one separates key from value.
		if (at > 0) map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return map;
}

/** `yes` for a yes-flag, `N` for a count that must be at least one. */
function flag(answer: Map<string, string>, key: string): boolean {
	return answer.get(key) === "yes";
}

function present(answer: Map<string, string>, key: string): boolean {
	return Number.parseInt(answer.get(key) ?? "0", 10) > 0;
}

export const agentUserDirs: Task = {
	id: "agent-user.dirs",
	feature: "agent-user",
	needsRoot: false,
	title: "the shared work dir, the transcripts, and the as-agent helper",

	async check(ctx: TaskContext): Promise<boolean> {
		const agentUser = await agentUserOf(ctx);
		const paths = await resolvePaths(ctx, agentUser);
		const result = await runScript(ctx, probe(paths, agentUser));
		if (result.code !== 0) return false;
		const answer = answers(result.stdout);
		// Sanity: if we probed the wrong user, nothing below means anything.
		if (answer.get("agent_user") !== agentUser) return false;
		// Refuse a filesystem that does not do the kernel ACL check this design
		// rests on, BEFORE anything is changed — a deny that is silently ignored
		// is worse than no deny, because the check would go on calling the machine
		// protected.
		const fs = answer.get("home_fs") ?? "unknown";
		if (fs === "unknown" || UNSUPPORTED_FS.has(fs)) {
			throw new Error(
				`Your home is on a ${fs} filesystem, which does not apply POSIX ACLs the way this setup needs (fs type: ${fs}). The deny that keeps the agent user out of your files would silently do nothing, so I've changed nothing. Set up the agent user on a local filesystem, or on a home mount that supports ACLs.`,
			);
		}

		if (answer.get("work_group") !== COLLAB_GROUP) return false;
		if (!flag(answer, "work_setgid")) return false;
		if (!present(answer, "work_acl") || !present(answer, "work_default_acl")) return false;
		if (!present(answer, "home_acl")) return false;
		// An INHERITED deny on the home, plus the two kernel settings the deny
		// design leans on.
		if (!present(answer, "home_default_deny")) return false;
		if (answer.get("hardlinks") !== "1" || answer.get("tiocsti") !== "0") return false;
		// Every top-level entry outside the allowed set must carry the deny, and
		// every direct child of the config dir too. The probe NAMES the ones that
		// do not, so a machine that has drifted reports what drifted.
		const unprotectedTop = answer.get("unprotected_top") ?? "";
		if (unprotectedTop !== "") {
			ctx.log(
				`agent-user.dirs: these are readable by $agentUser and should not be: ${unprotectedTop.replace(/,$/, "")}. Running setup again denies them.`,
			);
			return false;
		}
		const unprotectedClaude = answer.get("unprotected_claude") ?? "";
		if (unprotectedClaude !== "") {
			ctx.log(
				`agent-user.dirs: these in ${paths.claude} are readable by $agentUser and should not be: ${unprotectedClaude.replace(/,$/, "")}. Running setup again denies them.`,
			);
			return false;
		}
		// Traverse on the config dir, plus the inherited deny there too.
		if (!present(answer, "claude_acl")) return false;
		if (!present(answer, "claude_default_deny")) return false;
		for (const name of READABLE_FILES) {
			if (!present(answer, `read_${name}`)) return false;
		}
		for (const name of READABLE_DIRS) {
			if (!present(answer, `read_${name}`)) return false;
		}
		if (answer.get("projects_group") !== COLLAB_GROUP) return false;
		if (!flag(answer, "projects_setgid")) return false;
		if (!present(answer, "projects_acl")) return false;
		for (const entry of SYMLINKS) {
			const target = answer.get(`link_${entry.name}`);
			if (target === undefined || target === "missing" || target === "") return false;
			if (target !== expectedTarget(paths, entry.name)) return false;
		}
		if (!flag(answer, "as_agent")) return false;
		return present(answer, "bashrc_umask") && present(answer, "bashrc_physical");
	},

	async apply(ctx: TaskContext): Promise<void> {
		const agentUser = await agentUserOf(ctx);
		const paths = await resolvePaths(ctx, agentUser);

		// The agent's config dir must exist before its symlinks can be verified.
		// Only `agent-user.create` makes it, from the root script, and on a clean
		// machine the user has not run that yet — which is exactly the first run of
		// this feature.
		//
		// It must NOT throw here. The runner treats a throwing apply as a bug and
		// exits 1, which would mean the very first `machine setup --features
		// agent-user` on a clean machine dies instead of printing the root script.
		// So: say what is missing and return, leaving the check to fail; the next
		// run (after the user has run the script) does the work.
		//
		// Note this is now a READ check. This task no longer writes anything inside
		// the agent's home — the symlinks are made by the agent, in the root script.
		const ready = await runScript(
			ctx,
			`test -d ${shellQuote(paths.agentClaude)} && test -r ${shellQuote(paths.agentClaude)}`,
		);
		if (ready.code !== 0) {
			ctx.log(
				`agent-user.dirs: ${paths.agentClaude} isn't there yet — that's the agent-user.create root script, so I'll finish this once you've run it.`,
			);
			return;
		}

		// The shared work dir. chgrp/chmod first so the recursive ACL has a group
		// to name, and the setgid pass after so the mode change above can't strip
		// it back off.
		await runOrFail(ctx, "create the shared work dir", `mkdir -p ${shellQuote(paths.work)}`);
		await runOrFail(
			ctx,
			"share the work dir with the collab group",
			[
				`chgrp -R ${COLLAB_GROUP} ${shellQuote(paths.work)}`,
				`chmod -R g+rwx ${shellQuote(paths.work)}`,
				// Every DIRECTORY gets setgid, not just the top: a new subdirectory
				// made by either user then keeps the group, which is what stops the
				// sharing decaying one level down at a time.
				`find ${shellQuote(paths.work)} -type d -exec chmod g+s {} +`,
				`setfacl -R -d -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.work)}`,
				`setfacl -R -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.work)}`,
			].join("; "),
		);

		// Traverse on the home for the shared group, and an inherited DENY for
		// everything created under it from now on.
		//
		// The deny is the point of the whole design. `collab` has to be able to
		// traverse the home (otherwise the agent cannot reach work/), and that
		// traverse would otherwise expose every world-readable file whose path it
		// can guess. The kernel resolves a matching named-group entry before ever
		// considering `other`, so `g:collab:---` denies the agent whatever the
		// file's own mode says, and chmod cannot reopen it.
		await runOrFail(
			ctx,
			"protect the home with a deny for the shared group",
			[
				`setfacl -m g:${COLLAB_GROUP}:--x ${shellQuote(paths.home)}`,
				`setfacl -d -m g:${COLLAB_GROUP}:--- ${shellQuote(paths.home)}`,
			].join("; "),
		);

		// The entries that exist NOW, one level down. Non-recursive: the work dir
		// and the config dir carry their own, finer-grained entries, and a
		// recursive deny would hit every file in them.
		const topDenied = await runOrFail(
			ctx,
			"deny the shared group access to your other top-level entries",
			denyDirectChildren(paths.home, TOP_LEVEL_ALLOWED),
		);
		reportDenyFailures(ctx, "your home", topDenied);

		// The config dir: traverse plus an inherited deny, then the same one-level
		// deny on its children except the shared ones.
		//
		// `-k` first: it removes the DEFAULT ACL, which an earlier version of this
		// task set to `g:collab:rX`. That default would be inherited by every file
		// created in the dir afterwards — history, debug logs, a future credential.
		await runOrFail(
			ctx,
			"protect the config dir",
			[
				`setfacl -k ${shellQuote(paths.claude)}`,
				`setfacl -m g:${COLLAB_GROUP}:--x ${shellQuote(paths.claude)}`,
				`setfacl -d -m g:${COLLAB_GROUP}:--- ${shellQuote(paths.claude)}`,
			].join("; "),
		);
		const claudeDenied = await runOrFail(
			ctx,
			"deny the shared group access to the rest of your config dir",
			denyDirectChildren(paths.claude, CLAUDE_CHILDREN_ALLOWED),
		);
		reportDenyFailures(ctx, paths.claude, claudeDenied);

		// The shared entries, re-granted AFTER the deny: settings.json and
		// CLAUDE.md are rewritten by rename by Claude Code, so a replaced file
		// arrives with the inherited default and no access entry. Guarded on
		// existence, because `setfacl` on a missing file fails and `set -e` would
		// stop the whole task on a machine that simply has no CLAUDE.md yet.
		await runOrFail(
			ctx,
			"grant the agent read access to the shared config entries",
			[
				...READABLE_FILES.map(
					(name) =>
						`[ -e ${shellQuote(`${paths.claude}/${name}`)} ] && setfacl -m g:${COLLAB_GROUP}:r-- ${shellQuote(`${paths.claude}/${name}`)} || true`,
				),
				...READABLE_DIRS.map((name) => {
					const dir = `${paths.claude}/${name}`;
					return [
						// Created here, in the PRIMARY's own config dir, because the
						// grants below are on them and the check demands the grants: a
						// dir that does not exist cannot carry an ACL, so without the
						// mkdir this task could never settle on a machine that has no
						// skills/ or agents/ yet.
						`mkdir -p ${shellQuote(dir)}`,
						`setfacl -R -m g:${COLLAB_GROUP}:rX ${shellQuote(dir)}`,
						`setfacl -d -m g:${COLLAB_GROUP}:rX ${shellQuote(dir)}`,
					].join("; ");
				}),
			].join("\n"),
		);

		// projects/ is the shared transcripts dir: the only tree that is walked.
		await runOrFail(
			ctx,
			"share the transcripts dir",
			[
				`mkdir -p ${shellQuote(paths.projects)}`,
				`chgrp -R ${COLLAB_GROUP} ${shellQuote(paths.projects)}`,
				`chmod -R g+rwx ${shellQuote(paths.projects)}`,
				`find ${shellQuote(paths.projects)} -type d -exec chmod g+s {} +`,
				`setfacl -R -d -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.projects)}`,
				`setfacl -R -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.projects)}`,
			].join("; "),
		);

		// The as-agent helper: the one place the user types a privileged command
		// themselves. hyper writes the file; it never runs it (C-6).
		await runOrFail(
			ctx,
			"install the as-agent helper",
			[
				`mkdir -p ${shellQuote(paths.bin)}`,
				`cat > ${shellQuote(`${paths.bin}/as-agent`)} <<'HYPER_AS_AGENT_EOF'`,
				asAgentScript(agentUser).trimEnd(),
				"HYPER_AS_AGENT_EOF",
				`chmod 0755 ${shellQuote(`${paths.bin}/as-agent`)}`,
			].join("\n"),
		);

		// The shell lines for the PRIMARY user, appended once each. Grep-guarded so
		// a second run adds nothing (C-15) and so a line the user already added is
		// not duplicated. (The agent's own .bashrc is done by the agent, in the
		// root script.)
		for (const line of BASHRC_LINES) {
			await runOrFail(
				ctx,
				`add "${line}" to your .bashrc`,
				[
					`touch ${shellQuote(`${paths.home}/.bashrc`)}`,
					`grep -qxF ${shellQuote(line)} ${shellQuote(`${paths.home}/.bashrc`)} || printf '%s\\n' ${shellQuote(line)} >> ${shellQuote(`${paths.home}/.bashrc`)}`,
				].join("; "),
			);
		}
	},
};

/** Where an entry in the agent's config dir must point. */
function expectedTarget(paths: AgentPaths, name: string): string {
	return `${paths.claude}/${name}`;
}

/** Resolve every path the task needs, in one place so apply and check agree. */
async function resolvePaths(ctx: TaskContext, agentUser: string): Promise<AgentPaths> {
	const home = await homeOf(ctx);
	const agentHome = await agentHomeOf(ctx, agentUser);
	return agentPaths(home, agentHome);
}

/**
 * Whether this machine has the packages this task needs.
 *
 * Exported for the e2e harness, which asserts the failure message rather than
 * the exit code: a machine without `acl` fails every check here, and the useful
 * thing to say is which package to install, not "check returned false".
 */
export async function missingTools(ctx: TaskContext): Promise<string[]> {
	const result = await runScript(
		ctx,
		"for t in setfacl getfacl; do command -v $t >/dev/null 2>&1 || echo $t; done",
	);
	return result.stdout.split("\n").filter((line) => line.trim() !== "");
}

/** True when every tool this task shells out to is present. */
export async function hasTools(ctx: TaskContext): Promise<boolean> {
	return succeeds(
		ctx,
		"for t in setfacl getfacl stat; do command -v $t >/dev/null 2>&1 || exit 1; done",
	);
}
