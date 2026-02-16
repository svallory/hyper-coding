/**
 * Update installed kits by re-fetching from their recorded source
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Args, Flags } from "@oclif/core";
import { downloadTemplate } from "giget";
import { BaseCommand } from "#/base-command.js";
import {
	type KitManifestEntry,
	addKitToManifest,
	extractPackageVersion,
	loadManifest,
} from "#/manifest.js";
import { resolveKitSource } from "#/source-resolver.js";
import { findProjectRoot } from "#/utils/find-project-root.js";

export default class KitUpdate extends BaseCommand<typeof KitUpdate> {
	static override description = "Update installed kits from their original source";

	static override examples = [
		"<%= config.bin %> kit update nextjs",
		"<%= config.bin %> kit update --all",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		all: Flags.boolean({
			description: "Update all installed kits",
			default: false,
		}),
	};

	static override args = {
		kit: Args.string({
			description: "Name of the kit to update",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(KitUpdate);

		if (!args.kit && !flags.all) {
			this.error(
				"Specify a kit name or use --all to update all kits.\n" +
					"Usage: hypergen kit update <kit-name>\n" +
					"       hypergen kit update --all",
			);
		}

		const projectInfo = findProjectRoot(flags.cwd);
		const projectRoot = projectInfo.workspaceRoot;
		const manifest = loadManifest(projectRoot);

		if (Object.keys(manifest.kits).length === 0) {
			this.log("No kits installed. Install one with: hypergen kit install <source>");
			return;
		}

		if (flags.all) {
			const kitNames = Object.keys(manifest.kits);
			this.log(`Updating ${kitNames.length} kit(s)...`);

			let succeeded = 0;
			let failed = 0;

			for (const kitName of kitNames) {
				try {
					await this.updateKit(projectRoot, kitName, manifest.kits[kitName]);
					succeeded++;
				} catch (error: any) {
					this.warn(`Failed to update ${kitName}: ${error.message}`);
					failed++;
				}
			}

			this.log(`\n${succeeded} updated, ${failed} failed`);
		} else {
			const kitName = args.kit!;
			const entry = manifest.kits[kitName];

			if (!entry) {
				const available = Object.keys(manifest.kits).join(", ");
				this.error(`Kit not found: ${kitName}\n` + `Installed kits: ${available || "(none)"}`);
			}

			await this.updateKit(projectRoot, kitName, entry);
		}
	}

	private async updateKit(
		projectRoot: string,
		kitName: string,
		entry: KitManifestEntry,
	): Promise<void> {
		this.log(`\nUpdating kit: ${kitName}`);
		this.log(`  Source: ${entry.source} (${entry.type})`);

		if (entry.type === "npm" || entry.type === "jsr") {
			this.log("  npm/JSR kits are updated through your package manager.");
			this.log(`  Run: bun update ${entry.source}`);
			return;
		}

		const kitsDir = join(projectRoot, ".hyper", "kits");
		const targetDir = join(kitsDir, kitName);

		// Remove existing kit directory
		if (existsSync(targetDir)) {
			rmSync(targetDir, { recursive: true, force: true });
		}

		// Re-install from original source
		const resolved = resolveKitSource(entry.source);
		let commit: string | undefined;
		let branch: string | undefined = entry.branch;
		let tag: string | undefined = entry.tag;

		switch (resolved.type) {
			case "github":
			case "gitlab":
			case "bitbucket": {
				const gitInfo = await this.cloneFromGitHost(resolved, targetDir);
				commit = gitInfo.commit;
				branch = gitInfo.branch || branch;
				tag = gitInfo.tag || tag;
				break;
			}

			case "git": {
				await this.cloneFromGitUrl(resolved.source, targetDir);
				break;
			}

			case "local": {
				const { cpSync } = await import("node:fs");
				const { basename, isAbsolute, resolve } = await import("node:path");

				const absoluteSource = isAbsolute(resolved.source)
					? resolved.source
					: resolve(this.flags.cwd, resolved.source);

				if (!existsSync(absoluteSource)) {
					throw new Error(`Source path does not exist: ${absoluteSource}`);
				}

				cpSync(absoluteSource, targetDir, {
					recursive: true,
					filter: (source) => {
						const name = basename(source);
						return !["node_modules", ".git", "dist", "build", ".DS_Store"].includes(name);
					},
				});
				break;
			}

			case "url": {
				const { mkdirSync } = await import("node:fs");
				const { execSync } = await import("node:child_process");

				mkdirSync(targetDir, { recursive: true });
				if (resolved.source.endsWith(".tar.gz") || resolved.source.endsWith(".tgz")) {
					execSync(`curl -L "${resolved.source}" | tar xz -C "${targetDir}" --strip-components=1`, {
						stdio: "inherit",
					});
				} else if (resolved.source.endsWith(".zip")) {
					const tempZip = join(targetDir, "temp.zip");
					execSync(
						`curl -L -o "${tempZip}" "${resolved.source}" && unzip -q "${tempZip}" -d "${targetDir}" && rm "${tempZip}"`,
						{
							stdio: "inherit",
						},
					);
				} else {
					throw new Error(
						"Unsupported archive format. Only .tar.gz, .tgz, and .zip are supported.",
					);
				}
				break;
			}

			default:
				throw new Error(`Unsupported source type for update: ${resolved.type}`);
		}

		// Extract new version
		const version = extractPackageVersion(targetDir);

		// Update manifest with new metadata
		const updatedEntry: KitManifestEntry = {
			...entry,
			installedAt: new Date().toISOString(),
			commit,
			version,
			branch,
			tag,
		};

		addKitToManifest(projectRoot, updatedEntry);

		const versionInfo = version ? ` (v${version})` : "";
		const prevVersion = entry.version ? ` (was v${entry.version})` : "";
		this.log(`  ✓ Updated${versionInfo}${prevVersion}`);
	}

	private async cloneFromGitHost(
		resolved: any,
		targetDir: string,
	): Promise<{ commit?: string; branch?: string; tag?: string }> {
		let branch: string | undefined;
		let tag: string | undefined;

		const branchMatch = resolved.source.match(/#([^/]+)$/);
		const tagMatch = resolved.source.match(/@([^/]+)$/);

		if (branchMatch) {
			branch = branchMatch[1];
		} else if (tagMatch) {
			tag = tagMatch[1];
		}

		try {
			await downloadTemplate(resolved.source, {
				dir: targetDir,
				force: true,
				offline: false,
			});
		} catch (error: any) {
			throw new Error(`Failed to download from git host: ${error.message}`);
		}

		return { branch, tag };
	}

	private async cloneFromGitUrl(gitUrl: string, targetDir: string): Promise<void> {
		try {
			await downloadTemplate(gitUrl, {
				dir: targetDir,
				force: true,
				offline: false,
			});
		} catch (error: any) {
			throw new Error(`Failed to download from git URL: ${error.message}`);
		}
	}
}
