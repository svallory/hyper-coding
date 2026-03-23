import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { HqConfig } from "../config/schema.js";

export interface Worktree {
	path: string;
	branch: string;
	isMain: boolean;
	isCurrent: boolean;
}

export interface Project {
	name: string;
	path: string;
	isGit: boolean;
	hasWorktrees: boolean;
	worktrees: Worktree[];
}

function isGitRepo(dir: string): boolean {
	// .git can be a directory (regular repo) or a file (worktree checkout)
	return existsSync(resolve(dir, ".git"));
}

function parseWorktreeListPorcelain(output: string): Worktree[] {
	const worktrees: Worktree[] = [];
	let current: Partial<Worktree> = {};

	for (const line of output.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current.path) worktrees.push(current as Worktree);
			current = { path: line.slice(9), isMain: false, isCurrent: false };
		} else if (line.startsWith("branch ")) {
			const ref = line.slice(7); // refs/heads/main -> main
			current.branch = ref.replace("refs/heads/", "");
		} else if (line === "bare") {
			current.branch = "(bare)";
		} else if (line === "detached") {
			current.branch = current.branch ?? "(detached)";
		} else if (line === "") {
			// blank line = end of entry
		}
	}

	if (current.path) worktrees.push(current as Worktree);

	// Mark first as main
	if (worktrees.length > 0) {
		worktrees[0]!.isMain = true;
	}

	return worktrees;
}

function getWorktrees(projectDir: string): Worktree[] {
	// Try wt list --format=json first (richer data)
	const wtResult = spawnSync("wt", ["list", "--format=json"], {
		cwd: projectDir,
		encoding: "utf-8",
		timeout: 5000,
	});

	if (wtResult.status === 0 && wtResult.stdout) {
		try {
			const data = JSON.parse(wtResult.stdout) as Array<{
				branch: string;
				path: string;
				is_main: boolean;
				is_current: boolean;
			}>;
			return data.map((w) => ({
				path: w.path,
				branch: w.branch,
				isMain: w.is_main,
				isCurrent: w.is_current,
			}));
		} catch {
			// Fall through to git worktree list
		}
	}

	// Fallback to git worktree list
	const gitResult = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd: projectDir,
		encoding: "utf-8",
		timeout: 5000,
	});

	if (gitResult.status === 0 && gitResult.stdout) {
		return parseWorktreeListPorcelain(gitResult.stdout);
	}

	return [];
}

function discoverDir(dir: string, namePrefix: string, config: HqConfig): Project[] {
	const projects: Project[] = [];

	let entries: string[];
	try {
		entries = readdirSync(dir).filter((e) => {
			const full = resolve(dir, e);
			return statSync(full).isDirectory() && !e.startsWith(".");
		});
	} catch {
		return projects;
	}

	for (const entry of entries) {
		const fullPath = resolve(dir, entry);
		const projectName = namePrefix ? `${namePrefix}/${entry}` : entry;
		const override = config.projects[entry];

		// If configured as a group, recurse
		if (override?.type === "group") {
			projects.push(...discoverDir(fullPath, projectName, config));
			continue;
		}

		const git = isGitRepo(fullPath);
		let worktrees: Worktree[] = [];
		let hasWorktrees = false;

		if (git) {
			worktrees = getWorktrees(fullPath);
			hasWorktrees = worktrees.length > 1;
		}

		projects.push({
			name: projectName,
			path: fullPath,
			isGit: git,
			hasWorktrees,
			worktrees,
		});
	}

	return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export function listProjects(config: HqConfig): Project[] {
	return discoverDir(config.projects_root, "", config);
}

export function findProject(name: string, config: HqConfig): Project | undefined {
	const projects = listProjects(config);
	return projects.find((p) => p.name === name);
}

export function resolveProjectDir(project: string, config: HqConfig): string {
	if (project.startsWith("/")) return project;
	return resolve(config.projects_root, project);
}

export function createWorktree(projectDir: string, branch: string): string {
	const result = spawnSync("wt", ["switch", "-c", branch], {
		cwd: projectDir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
	});

	if (result.status !== 0) {
		throw new Error(`Failed to create worktree '${branch}': ${result.stderr}`);
	}

	// wt switch changes directory — get the new worktree path
	// Parse it from wt list
	const worktrees = getWorktrees(projectDir);
	const wt = worktrees.find((w) => w.branch === branch);
	if (wt) return wt.path;

	// Fallback: construct path from worktrunk convention (sibling dir)
	const repoName = basename(projectDir);
	const sanitizedBranch = branch.replace(/\//g, "-");
	return resolve(projectDir, "..", `${repoName}.${sanitizedBranch}`);
}

export function findWorktreePath(projectDir: string, branchOrName: string): string | undefined {
	const worktrees = getWorktrees(projectDir);
	const match = worktrees.find(
		(w) => w.branch === branchOrName || basename(w.path) === branchOrName,
	);
	return match?.path;
}
