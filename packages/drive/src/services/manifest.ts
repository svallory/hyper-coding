/**
 * The hyperdrive manifest: `spaces.yaml` on `main` of the user's one private
 * hyperdrive repository.
 *
 * The CLI keeps ONE ordinary clone of `main` at `~/.hyper/drive/` (created by
 * `hyper drive init`); every read and write happens there.
 *
 * A hyperdrive is shared by the owner's whole fleet, so several machines can
 * write it without having seen each other. git must never merge
 * `spaces.yaml`: a commit is a diff of YAML text, so a rebase picks a winner
 * and the losing entry is silently gone. Instead every write fetches, reads
 * the base manifest from `origin/main`, replays the locally recorded
 * mutations onto it BY SPACE NAME, resets onto the remote and commits — a
 * rejected push repeats that from a fresh fetch. See `applyMutation`.
 *
 * C-2 note: `services/space-git.ts` is the only git runner for SPACE branches
 * (explicit --git-dir/--work-tree). The manifest clone is an ordinary repo,
 * so this module keeps its own small `driveGit(args)` helper; the C-2 grep
 * records `manifest.ts` as the second allowed git-runner match.
 *
 * Manifest commits are generated bookkeeping, not authored history, so they
 * run with `commit.gpgsign=false`: a signer that is unavailable to the CLI
 * must not be able to strand the manifest mid-write. Commits to a space
 * branch are the user's own work and do respect their signing config.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
	EMPTY_MANIFEST,
	type Manifest,
	ManifestError,
	type SpaceEntry,
	validateManifest,
} from "#config/schema";

const MANIFEST_FILE = "spaces.yaml";
const BRANCH = "main";

/** Bookkeeping commits are never signed; see the module comment. */
const NO_SIGN = ["-c", "commit.gpgsign=false"];

const README_TEXT = `# Hyperdrive

This is a hyperdrive repository: it holds the manifest of every hyper space
on this machine's owner's fleet.

- \`main\` (this branch) holds only this README and \`spaces.yaml\`, the manifest.
- Each space lives on its own orphan branch \`space/<name>\` or
  \`space/<group>/<name>\`, created by \`hyper space init\`.
`;

/**
 * The one place the checkout path is built: `$HYPER_HOME/drive` when
 * `HYPER_HOME` is set (tests), else `~/.hyper/drive`.
 */
export function driveCheckoutDir(): string {
	const home = process.env.HYPER_HOME;
	return home ? resolve(home, "drive") : join(homedir(), ".hyper", "drive");
}

/** The checkout's `remote.origin.url`, or null when there is no checkout. */
export function driveCheckoutOrigin(): string | null {
	const dir = driveCheckoutDir();
	if (!existsSync(join(dir, ".git"))) return null;
	const result = driveGit(["config", "--get", "remote.origin.url"], dir);
	return result.ok ? result.stdout.trim() : null;
}

function manifestPath(): string {
	return join(driveCheckoutDir(), MANIFEST_FILE);
}

interface GitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

/**
 * Run git with an argument array — never a shell string. Prompts are disabled
 * (`GIT_TERMINAL_PROMPT=0`) so a credential question can never hang the CLI,
 * and `GIT_DIR`/`GIT_WORK_TREE` are stripped from the child env so a caller
 * inside a space's own git dir cannot redirect these commands there.
 */
function driveGit(args: readonly string[], cwd: string): GitResult {
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
	delete env.GIT_DIR;
	delete env.GIT_WORK_TREE;
	const result = spawnSync("git", [...args], { cwd, env, encoding: "utf8" });
	if (result.error) {
		throw new ManifestError(
			"git",
			`I couldn't run git — ${result.error.message}. Is git installed?`,
		);
	}
	return {
		ok: result.status === 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function warn(message: string): void {
	process.stderr.write(`warning: ${message}\n`);
}

/** git's own words for "someone else pushed first", as opposed to "no network". */
function isRejected(result: GitResult): boolean {
	return /non-fast-forward|rejected|fetch first|behind its remote/i.test(
		`${result.stderr}\n${result.stdout}`,
	);
}

/**
 * Commits in the checkout need an identity. Respect the user's git config
 * when they have one; otherwise set a repo-local default so the manifest can
 * commit on a fresh machine without configuring git first.
 */
function ensureGitIdentity(dir: string): void {
	if (driveGit(["config", "user.name"], dir).stdout.trim() === "") {
		driveGit(["config", "user.name", "hyperdrive"], dir);
	}
	if (driveGit(["config", "user.email"], dir).stdout.trim() === "") {
		driveGit(["config", "user.email", "hyperdrive@localhost"], dir);
	}
}

function hasCommits(dir: string): boolean {
	return driveGit(["rev-parse", "--verify", "HEAD"], dir).ok;
}

/**
 * True when the checkout holds commits the remote has not seen. An unborn
 * `origin/main` (fresh clone of an empty remote, or an init that never
 * pushed) is not "ahead" — there is nothing to push yet.
 */
function isAhead(dir: string): boolean {
	const base = driveGit(["rev-parse", "--verify", "origin/main"], dir);
	if (!base.ok || !hasCommits(dir)) return false;
	const count = driveGit(["rev-list", "--count", "origin/main..HEAD"], dir);
	return count.ok && count.stdout.trim() !== "0";
}

/**
 * Push `main` on the path that does not rewrite anything: hand over a commit
 * that already exists (an init whose first push failed, or an offline write).
 * A rejected push here is NOT retried by rebasing — `applyMutation` owns the
 * replay-by-name path, and rebasing here is exactly what used to lose an
 * entry. An unreachable remote is only warned about.
 */
function pushMain(dir: string, what: string): boolean {
	const push = driveGit(["push", "origin", BRANCH], dir);
	if (push.ok) return true;
	if (isRejected(push)) {
		warn(
			`the hyperdrive moved while I was pushing ${what}; ` +
				"the local change is recorded and a manifest write will republish it.",
		);
		return false;
	}
	warn(
		`${what} is committed locally but I couldn't push it (the hyperdrive is unreachable) — ` +
			`the next manifest write will try again. git said: ${push.stderr.trim() || push.stdout.trim()}`,
	);
	return false;
}

/**
 * Write the README and the empty manifest, commit them, and push with an
 * upstream. Split out from `ensureDriveCheckout` because it must also be able
 * to resume a checkout whose first commit never happened (a signer failure, a
 * crash, a remote that was briefly unreachable) — leaving a `.git` alone is
 * not evidence that a checkout is finished.
 */
function initialiseMain(dir: string, remote: string): void {
	ensureGitIdentity(dir);
	writeFileSync(join(dir, "README.md"), README_TEXT, "utf-8");
	writeFileSync(
		join(dir, MANIFEST_FILE),
		serializeManifest(structuredClone(EMPTY_MANIFEST)),
		"utf-8",
	);
	driveGit(["add", "README.md", MANIFEST_FILE], dir);
	const commit = driveGit([...NO_SIGN, "commit", "-m", "manifest: initialise hyperdrive"], dir);
	if (!commit.ok) {
		throw new ManifestError(dir, `the initial commit failed: ${commit.stderr.trim()}`);
	}
	const push = driveGit(["push", "-u", "origin", BRANCH], dir);
	if (!push.ok) {
		warn(
			`the hyperdrive is initialised locally but I couldn't push it to ${remote} (offline?) — ` +
				`the next manifest write will try again. git said: ${push.stderr.trim()}`,
		);
	}
}

/**
 * Ensure the local clone of the hyperdrive's `main` branch exists.
 *
 * - Already cloned: verify the origin matches `remote` (a mismatch means the
 *   checkout belongs to a different hyperdrive), finish an unfinished init if
 *   the branch has no commit yet, then fast-forward and push anything local.
 * - No clone: probe the remote with `git ls-remote`. When the remote has a
 *   `main`, clone it; when it is reachable but empty, initialise `main` and
 *   push. An unreachable remote is a friendly error naming the URL.
 *
 * `created` is true when this call produced the checkout (clone or init).
 */
export function ensureDriveCheckout(remote: string): { dir: string; created: boolean } {
	const dir = driveCheckoutDir();

	if (existsSync(join(dir, ".git"))) {
		const origin = driveGit(["config", "--get", "remote.origin.url"], dir).stdout.trim();
		if (origin !== remote) {
			throw new ManifestError(
				dir,
				`the hyperdrive checkout there is a clone of ${JSON.stringify(origin)}, ` +
					`but your config points at ${JSON.stringify(remote)}. ` +
					"Move the checkout away or fix `remote` in your drive.toml.",
			);
		}
		// A `.git` on its own is not a finished checkout: a failed first commit
		// leaves an unborn branch with the files staged, and reporting "already
		// exists" there would leave the hyperdrive without a `main` forever.
		if (!hasCommits(dir)) {
			initialiseMain(dir, remote);
			return { dir, created: true };
		}
		const pull = driveGit(["pull", "--ff-only", "origin", BRANCH], dir);
		if (!pull.ok) {
			// Not "(offline?)": a fast-forward that cannot happen is usually
			// LOCAL divergence, and naming it offline sends the reader after the
			// wrong problem. A manifest write reconciles properly regardless.
			warn(
				`I couldn't fast-forward the hyperdrive checkout from ${remote} — continuing with the ` +
					`local copy. This is usually local divergence or an unreachable remote, not a lost ` +
					`entry: the next manifest write reconciles by space name. git said: ` +
					`${pull.stderr.trim() || pull.stdout.trim()}`,
			);
		}
		// An init whose push failed leaves the commit here and nothing
		// upstream, so hand it over whenever local is ahead — not only after a
		// new write. A successful push means the recorded mutations are on the
		// remote and the pending log can go.
		if (isAhead(dir) && pushMain(dir, "the pending hyperdrive init")) clearPendingLog(dir);
		return { dir, created: false };
	}

	const probe = driveGit(["ls-remote", "--heads", remote, BRANCH], process.cwd());
	if (!probe.ok) {
		throw new ManifestError(
			remote,
			`I couldn't reach your hyperdrive at ${remote} — check the URL and your network. ` +
				`git said: ${probe.stderr.trim() || probe.stdout.trim() || "no output"}`,
		);
	}

	mkdirSync(dir, { recursive: true });

	if (probe.stdout.includes(`refs/heads/${BRANCH}`)) {
		const clone = driveGit(
			["clone", "--branch", BRANCH, "--single-branch", remote, dir],
			process.cwd(),
		);
		if (!clone.ok) {
			throw new ManifestError(
				remote,
				`cloning your hyperdrive failed: ${clone.stderr.trim() || clone.stdout.trim()}`,
			);
		}
		ensureGitIdentity(dir);
		return { dir, created: true };
	}

	// Reachable but no `main` yet: this is a brand-new hyperdrive.
	for (const step of [
		["init", "-b", BRANCH],
		["remote", "add", "origin", remote],
	] as const) {
		const result = driveGit(step, dir);
		if (!result.ok) {
			throw new ManifestError(dir, `git ${step[0]} failed: ${result.stderr.trim()}`);
		}
	}
	initialiseMain(dir, remote);
	return { dir, created: true };
}

/**
 * Serialise a manifest with a stable key order and spaces sorted by `name`,
 * so rewrites are diff-minimal and "did anything change?" is a string
 * comparison. Sorting compares code points, not the ambient locale, so the
 * file reads the same on every machine.
 */
function serializeManifest(manifest: Manifest): string {
	const spaces = [...manifest.spaces]
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.map((space) => ({
			name: space.name,
			branch: space.branch,
			group: space.group,
			path: space.path,
			layout: space.layout,
			repos: space.repos.map((repo) =>
				repo.slug === undefined
					? { url: repo.url, default_branch: repo.default_branch }
					: { url: repo.url, default_branch: repo.default_branch, slug: repo.slug },
			),
			cadence: space.cadence,
			tracked: space.tracked,
			public: space.public,
		}));
	return stringifyYaml({ spaces });
}

/**
 * Read and validate `spaces.yaml` from the checkout. A missing checkout is a
 * friendly error pointing at `hyper drive init`; a missing file on an
 * initialised checkout reads as an empty manifest.
 */
export function readManifest(): Manifest {
	const dir = driveCheckoutDir();
	if (!existsSync(join(dir, ".git"))) {
		throw new ManifestError(
			dir,
			"there's no hyperdrive checkout there yet — run `hyper drive init` first.",
		);
	}
	const path = manifestPath();
	if (!existsSync(path)) return structuredClone(EMPTY_MANIFEST);
	let raw: unknown;
	try {
		raw = parseYaml(readFileSync(path, "utf-8"));
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new ManifestError(path, `the YAML didn't parse — ${detail}`);
	}
	return validateManifest(path, raw);
}

/** One intended change, recorded until it has been pushed. */
type Mutation =
	| { verb: "add" | "update"; name: string; entry: SpaceEntry }
	| { verb: "remove"; name: string };

/**
 * Local mutations waiting to reach the remote, one JSON object per line.
 *
 * This file is the record of intent that survives a failed push. Replaying
 * commits instead was the other option, but a commit is a diff of YAML TEXT:
 * rebasing two machines' edits to `spaces.yaml` is git merging the file, and
 * whichever entry lost that merge was silently dropped from the manifest.
 * Mutations are keyed by space NAME, so replaying them onto whatever the
 * remote currently holds cannot lose an entry.
 */
const PENDING_FILE = ".hyper-pending.jsonl";

const MAX_PUSH_ATTEMPTS = 3;

function pendingPath(dir: string): string {
	return join(dir, PENDING_FILE);
}

/** Keep the pending log out of `git status`; it is local bookkeeping. */
function excludePendingFile(dir: string): void {
	const exclude = join(dir, ".git", "info", "exclude");
	try {
		mkdirSync(join(dir, ".git", "info"), { recursive: true });
		const current = existsSync(exclude) ? readFileSync(exclude, "utf-8") : "";
		if (!current.split("\n").includes(PENDING_FILE)) {
			writeFileSync(
				exclude,
				`${current}${current && !current.endsWith("\n") ? "\n" : ""}${PENDING_FILE}\n`,
			);
		}
	} catch {
		// Not being able to hide the file is cosmetic: we only ever `git add`
		// spaces.yaml, so the pending log can never reach the remote.
	}
}

function loadPending(dir: string): Mutation[] {
	const path = pendingPath(dir);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Mutation];
			} catch {
				// A truncated last line from a killed process must not wedge
				// every later write; drop it rather than refuse to work.
				return [];
			}
		});
}

function savePending(dir: string, pending: Mutation[]): void {
	if (pending.length === 0) {
		rmSync(pendingPath(dir), { force: true });
		return;
	}
	writeFileSync(
		pendingPath(dir),
		`${pending.map((mutation) => JSON.stringify(mutation)).join("\n")}\n`,
	);
}

function clearPendingLog(dir: string): void {
	rmSync(pendingPath(dir), { force: true });
}

/** Apply recorded mutations to a base manifest, keyed by space name. */
function replay(base: SpaceEntry[], mutations: readonly Mutation[]): SpaceEntry[] {
	const byName = new Map(base.map((space) => [space.name, space]));
	for (const mutation of mutations) {
		if (mutation.verb === "remove") byName.delete(mutation.name);
		else byName.set(mutation.name, mutation.entry);
	}
	return [...byName.values()];
}

/** The manifest as it exists at a given ref, empty when that ref has none. */
function readManifestAt(dir: string, ref: string): SpaceEntry[] {
	const show = driveGit(["show", `${ref}:${MANIFEST_FILE}`], dir);
	if (!show.ok) return [];
	let raw: unknown;
	try {
		raw = parseYaml(show.stdout);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new ManifestError(`${ref}:${MANIFEST_FILE}`, `the YAML didn't parse — ${detail}`);
	}
	if (raw === null || raw === undefined) return [];
	return validateManifest(`${ref}:${MANIFEST_FILE}`, raw).spaces;
}

/**
 * Finish or undo whatever git left half-done. A rebase or a detached HEAD
 * from an interrupted run would otherwise poison every later write, and
 * calling that "(offline?)" sends the reader looking at the wrong problem.
 */
function recoverCheckout(dir: string): void {
	const gitDir = join(dir, ".git");
	const inRebase =
		existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"));
	if (inRebase) {
		const abort = driveGit(["rebase", "--abort"], dir);
		warn(
			abort.ok
				? "an interrupted rebase was rolled back before writing the manifest."
				: `I couldn't roll back an interrupted rebase (${abort.stderr.trim()}); continuing anyway.`,
		);
	}
	const head = driveGit(["symbolic-ref", "-q", "HEAD"], dir);
	if (!head.ok) {
		const checkout = driveGit(["checkout", BRANCH], dir);
		if (!checkout.ok) {
			throw new ManifestError(
				dir,
				`the checkout is on a detached HEAD and I couldn't get back to ${BRANCH}: ${checkout.stderr.trim()}`,
			);
		}
	}
}

/**
 * Record one mutation and get it onto the remote.
 *
 * The sequence deliberately never lets git merge `spaces.yaml`: it fetches,
 * reads the BASE manifest from `origin/main` (or from local HEAD when the
 * remote is unreachable), replays every mutation recorded so far — including
 * this one — onto that base by space name, resets hard onto the remote so the
 * commits are clean children of it, then writes, commits and pushes. A
 * rejected push repeats the whole sequence from a fresh fetch, at most
 * {@link MAX_PUSH_ATTEMPTS} times.
 *
 * Each replayed mutation gets its OWN commit, so the remote's history shows
 * what actually happened (`manifest: add offB`, `manifest: update research`)
 * instead of one commit labelled with whichever write happened to carry it.
 * A mutation that changes nothing is skipped entirely — no commit, and no
 * line in the pending log.
 *
 * **Last writer wins, by name.** Replaying a pending mutation re-asserts that
 * space's entry even if another machine has since removed it: a machine that
 * was offline while a space was deleted elsewhere will resurrect it when it
 * comes back. That is a deliberate trade — refusing to replay would silently
 * drop the offline machine's own entries, which is the failure this whole
 * design exists to prevent — and it resolves on the next write from the
 * machine that actually removed the space.
 */
function applyMutation(mutation: Mutation): void {
	const dir = driveCheckoutDir();
	recoverCheckout(dir);
	excludePendingFile(dir);

	// Held in memory and only written to disk just before a commit: a
	// no-op must not leave a junk line behind for the next run to replay.
	const pending = [...loadPending(dir), mutation];

	for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
		const fetched = driveGit(["fetch", "origin", BRANCH], dir);
		const base = fetched.ok ? readManifestAt(dir, `origin/${BRANCH}`) : readManifestAt(dir, "HEAD");

		if (!fetched.ok) {
			// No remote to reconcile with: keep the entries locally, stacked on
			// HEAD, and let the next run publish them.
			if (commitReplay(dir, base, pending)) {
				warn(
					`the hyperdrive is unreachable, so ${mutation.name} is recorded locally only — ` +
						"the next write will publish it.",
				);
				return;
			}
			warn(
				`the hyperdrive is unreachable and ${mutation.name} is already recorded — ` +
					"nothing to commit.",
			);
			return;
		}

		const reset = driveGit(["reset", "--hard", `origin/${BRANCH}`], dir);
		if (!reset.ok) {
			throw new ManifestError(
				dir,
				`I couldn't reset the checkout onto the remote ${BRANCH}: ${reset.stderr.trim()}`,
			);
		}

		if (!commitReplay(dir, base, pending)) {
			// The remote already says exactly this: nothing to commit, nothing pending.
			clearPendingLog(dir);
			return;
		}

		const push = driveGit(["push", "origin", BRANCH], dir);
		if (push.ok) {
			clearPendingLog(dir);
			return;
		}
		if (isRejected(push)) {
			warn(
				`the hyperdrive moved while I was pushing ${mutation.name}; ` +
					`retrying against the current remote (attempt ${attempt} of ${MAX_PUSH_ATTEMPTS}).`,
			);
			continue;
		}
		warn(
			`${mutation.name} is recorded locally but I couldn't push it (the hyperdrive is unreachable) — ` +
				"the next manifest write will try again.",
		);
		return;
	}

	warn(
		`I couldn't publish ${mutation.name} after ${MAX_PUSH_ATTEMPTS} attempts because the hyperdrive kept ` +
			"moving. The change is recorded locally and no entry was lost; run any manifest command again to retry.",
	);
}

/**
 * Apply the pending mutations to a base manifest, committing one change at a
 * time so each keeps its own message. Returns false when nothing changed, in
 * which case nothing is written and nothing is recorded.
 *
 * The steps are computed before anything is touched, so a no-op leaves no
 * trace, and the pending log is written BEFORE the first commit: a crash
 * between the commit and its push must never leave a change committed with
 * nothing left to replay it.
 */
function commitReplay(dir: string, base: SpaceEntry[], pending: readonly Mutation[]): boolean {
	const steps: Array<{ mutation: Mutation; content: string }> = [];
	let spaces = base;
	let previous = serializeManifest({ spaces });
	for (const mutation of pending) {
		spaces = replay(spaces, [mutation]);
		const content = serializeManifest({ spaces });
		if (content === previous) continue;
		previous = content;
		steps.push({ mutation, content });
	}
	if (steps.length === 0) return false;

	savePending(dir, [...pending]);
	for (const step of steps) {
		writeSpacesYaml(dir, step.content);
		commitManifest(dir, step.mutation);
	}
	return true;
}

function writeSpacesYaml(dir: string, content: string): void {
	writeFileSync(manifestPath(), content, "utf-8");
	driveGit(["add", MANIFEST_FILE], dir);
}

function commitManifest(dir: string, mutation: Mutation): void {
	const commit = driveGit(
		[...NO_SIGN, "commit", "-m", `manifest: ${mutation.verb} ${mutation.name}`],
		dir,
	);
	if (!commit.ok) {
		// git explains "nothing to commit" on STDOUT, so stderr alone can leave
		// an empty reason.
		const reason = commit.stderr.trim() || commit.stdout.trim();
		throw new ManifestError(dir, `committing the manifest failed: ${reason}`);
	}
}

/**
 * Add a space to the manifest, or replace the entry of the same name. The
 * write is replayed by name onto the remote, so two machines adding spaces at
 * the same time both keep theirs.
 */
export function upsertSpace(entry: SpaceEntry): void {
	const manifest = readManifest();
	const existing = manifest.spaces.find((space) => space.name === entry.name);
	applyMutation({
		verb: existing === undefined ? "add" : "update",
		name: entry.name,
		entry,
	});
}

/** Remove a space from the manifest. */
export function removeSpace(name: string): void {
	readManifest();
	applyMutation({ verb: "remove", name });
}
