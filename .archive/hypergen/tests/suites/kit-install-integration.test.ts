import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInstallCommand, resolveKitSource } from "#/lib/kit/source-resolver";
import type { KitSourceType } from "#/lib/kit/source-resolver";

describe("Kit Install Integration Tests", () => {
	describe("End-to-End Source Resolution and Command Building", () => {
		interface TestCase {
			input: string;
			expectedType: KitSourceType;
			expectedCommands: {
				bun: string;
				npm: string;
				pnpm: string;
				yarn: string;
			};
		}

		const testCases: TestCase[] = [
			// NPM packages
			{
				input: "@kit/nextjs",
				expectedType: "npm",
				expectedCommands: {
					bun: "bun add '@kit/nextjs'",
					npm: "npm install '@kit/nextjs'",
					pnpm: "pnpm add '@kit/nextjs'",
					yarn: "yarn add '@kit/nextjs'",
				},
			},
			{
				input: "my-kit@1.2.3",
				expectedType: "npm",
				expectedCommands: {
					bun: "bun add 'my-kit@1.2.3'",
					npm: "npm install 'my-kit@1.2.3'",
					pnpm: "pnpm add 'my-kit@1.2.3'",
					yarn: "yarn add 'my-kit@1.2.3'",
				},
			},

			// GitHub shorthand
			{
				input: "svallory/hypergen-kit-nextjs",
				expectedType: "github",
				expectedCommands: {
					bun: "bun add 'github:svallory/hypergen-kit-nextjs'",
					npm: "npm install 'github:svallory/hypergen-kit-nextjs'",
					pnpm: "pnpm add 'github:svallory/hypergen-kit-nextjs'",
					yarn: "yarn add 'github:svallory/hypergen-kit-nextjs'",
				},
			},
			{
				input: "user/repo#develop",
				expectedType: "github",
				expectedCommands: {
					bun: "bun add 'github:user/repo#develop'",
					npm: "npm install 'github:user/repo#develop'",
					pnpm: "pnpm add 'github:user/repo#develop'",
					yarn: "yarn add 'github:user/repo#develop'",
				},
			},
			{
				input: "user/repo@v1.0.0",
				expectedType: "github",
				expectedCommands: {
					bun: "bun add 'github:user/repo@v1.0.0'",
					npm: "npm install 'github:user/repo@v1.0.0'",
					pnpm: "pnpm add 'github:user/repo@v1.0.0'",
					yarn: "yarn add 'github:user/repo@v1.0.0'",
				},
			},

			// Explicit GitHub prefix
			{
				input: "github:user/repo",
				expectedType: "github",
				expectedCommands: {
					bun: "bun add 'github:user/repo'",
					npm: "npm install 'github:user/repo'",
					pnpm: "pnpm add 'github:user/repo'",
					yarn: "yarn add 'github:user/repo'",
				},
			},

			// JSR packages
			{
				input: "jsr:@std/path",
				expectedType: "jsr",
				expectedCommands: {
					bun: "bun add 'jsr:@std/path'", // Bun has native JSR support
					npm: "npx jsr add @std/path", // npm/pnpm/yarn use npx jsr add
					pnpm: "npx jsr add @std/path",
					yarn: "npx jsr add @std/path",
				},
			},
			{
				input: "@jsr/std__path",
				expectedType: "jsr",
				expectedCommands: {
					bun: "bun add '@jsr/std__path'",
					npm: "npx jsr add @std__path",
					pnpm: "npx jsr add @std__path",
					yarn: "npx jsr add @std__path",
				},
			},

			// Git URLs
			{
				input: "https://github.com/user/repo.git",
				expectedType: "git",
				expectedCommands: {
					bun: "bun add 'https://github.com/user/repo.git'",
					npm: "npm install 'https://github.com/user/repo.git'",
					pnpm: "pnpm add 'https://github.com/user/repo.git'",
					yarn: "yarn add 'https://github.com/user/repo.git'",
				},
			},
			{
				input: "git+ssh://git@github.com/user/repo.git",
				expectedType: "git",
				expectedCommands: {
					bun: "bun add 'git+ssh://git@github.com/user/repo.git'",
					npm: "npm install 'git+ssh://git@github.com/user/repo.git'",
					pnpm: "pnpm add 'git+ssh://git@github.com/user/repo.git'",
					yarn: "yarn add 'git+ssh://git@github.com/user/repo.git'",
				},
			},

			// Local paths (Unix)
			{
				input: "./my-kit",
				expectedType: "local",
				expectedCommands: {
					bun: "bun add './my-kit'",
					npm: "npm install './my-kit'",
					pnpm: "pnpm add './my-kit'",
					yarn: "yarn add './my-kit'",
				},
			},
			{
				input: "../sibling-kit",
				expectedType: "local",
				expectedCommands: {
					bun: "bun add '../sibling-kit'",
					npm: "npm install '../sibling-kit'",
					pnpm: "pnpm add '../sibling-kit'",
					yarn: "yarn add '../sibling-kit'",
				},
			},
			{
				input: "/absolute/path/to/kit",
				expectedType: "local",
				expectedCommands: {
					bun: "bun add '/absolute/path/to/kit'",
					npm: "npm install '/absolute/path/to/kit'",
					pnpm: "pnpm add '/absolute/path/to/kit'",
					yarn: "yarn add '/absolute/path/to/kit'",
				},
			},

			// Local paths (Windows)
			{
				input: "C:\\Projects\\my-kit",
				expectedType: "local",
				expectedCommands: {
					bun: "bun add 'C:\\Projects\\my-kit'",
					npm: "npm install 'C:\\Projects\\my-kit'",
					pnpm: "pnpm add 'C:\\Projects\\my-kit'",
					yarn: "yarn add 'C:\\Projects\\my-kit'",
				},
			},
			{
				input: "C:/Projects/my-kit",
				expectedType: "local",
				expectedCommands: {
					bun: "bun add 'C:/Projects/my-kit'",
					npm: "npm install 'C:/Projects/my-kit'",
					pnpm: "pnpm add 'C:/Projects/my-kit'",
					yarn: "yarn add 'C:/Projects/my-kit'",
				},
			},

			// GitLab
			{
				input: "gitlab:user/repo",
				expectedType: "gitlab",
				expectedCommands: {
					bun: "bun add 'gitlab:user/repo'",
					npm: "npm install 'gitlab:user/repo'",
					pnpm: "pnpm add 'gitlab:user/repo'",
					yarn: "yarn add 'gitlab:user/repo'",
				},
			},

			// Bitbucket
			{
				input: "bitbucket:user/repo",
				expectedType: "bitbucket",
				expectedCommands: {
					bun: "bun add 'bitbucket:user/repo'",
					npm: "npm install 'bitbucket:user/repo'",
					pnpm: "pnpm add 'bitbucket:user/repo'",
					yarn: "yarn add 'bitbucket:user/repo'",
				},
			},

			// Tarball URL
			{
				input: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
				expectedType: "url",
				expectedCommands: {
					bun: "bun add 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz'",
					npm: "npm install 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz'",
					pnpm: "pnpm add 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz'",
					yarn: "yarn add 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz'",
				},
			},
		];

		testCases.forEach(({ input, expectedType, expectedCommands }) => {
			describe(`Input: ${input}`, () => {
				it(`resolves to type: ${expectedType}`, () => {
					const resolved = resolveKitSource(input);
					expect(resolved.type).toBe(expectedType);
				});

				it("builds correct command for bun", () => {
					const resolved = resolveKitSource(input);
					const cmd = buildInstallCommand(resolved, "bun", {});
					expect(cmd).toBe(expectedCommands.bun);
				});

				it("builds correct command for npm", () => {
					const resolved = resolveKitSource(input);
					const cmd = buildInstallCommand(resolved, "npm", {});
					expect(cmd).toBe(expectedCommands.npm);
				});

				it("builds correct command for pnpm", () => {
					const resolved = resolveKitSource(input);
					const cmd = buildInstallCommand(resolved, "pnpm", {});
					expect(cmd).toBe(expectedCommands.pnpm);
				});

				it("builds correct command for yarn", () => {
					const resolved = resolveKitSource(input);
					const cmd = buildInstallCommand(resolved, "yarn", {});
					expect(cmd).toBe(expectedCommands.yarn);
				});
			});
		});
	});

	describe("Installation Flags", () => {
		it("adds --dev flag correctly for all package managers", () => {
			const resolved = resolveKitSource("@kit/nextjs");

			expect(buildInstallCommand(resolved, "bun", { dev: true })).toBe("bun add -d '@kit/nextjs'");
			expect(buildInstallCommand(resolved, "npm", { dev: true })).toBe(
				"npm install -D '@kit/nextjs'",
			);
			expect(buildInstallCommand(resolved, "pnpm", { dev: true })).toBe(
				"pnpm add -D '@kit/nextjs'",
			);
			expect(buildInstallCommand(resolved, "yarn", { dev: true })).toBe(
				"yarn add -D '@kit/nextjs'",
			);
		});

		it("adds --global flag correctly for all package managers", () => {
			const resolved = resolveKitSource("@kit/nextjs");

			expect(buildInstallCommand(resolved, "bun", { global: true })).toBe(
				"bun add -g '@kit/nextjs'",
			);
			expect(buildInstallCommand(resolved, "npm", { global: true })).toBe(
				"npm install -g '@kit/nextjs'",
			);
			expect(buildInstallCommand(resolved, "pnpm", { global: true })).toBe(
				"pnpm add -g '@kit/nextjs'",
			);
			expect(buildInstallCommand(resolved, "yarn", { global: true })).toBe(
				"yarn global add '@kit/nextjs'",
			);
		});
	});

	describe("Critical GitHub Scenarios", () => {
		it("user/repo resolves to github (not npm)", () => {
			const resolved = resolveKitSource("kit/nextjs");
			expect(resolved.type).toBe("github");
			expect(resolved.source).toBe("github:kit/nextjs");
		});

		it("GitHub shorthand builds correct commands for all PMs", () => {
			const resolved = resolveKitSource("kit/nextjs");

			// All package managers should use github: prefix
			expect(buildInstallCommand(resolved, "bun", {})).toBe("bun add 'github:kit/nextjs'");
			expect(buildInstallCommand(resolved, "npm", {})).toBe("npm install 'github:kit/nextjs'");
			expect(buildInstallCommand(resolved, "pnpm", {})).toBe("pnpm add 'github:kit/nextjs'");
			expect(buildInstallCommand(resolved, "yarn", {})).toBe("yarn add 'github:kit/nextjs'");
		});

		it("does not confuse npm scoped packages with GitHub repos", () => {
			const npmPackage = resolveKitSource("@facebook/react");
			expect(npmPackage.type).toBe("npm");

			const githubRepo = resolveKitSource("facebook/react");
			expect(githubRepo.type).toBe("github");
		});
	});

	describe("Ambiguity Resolution", () => {
		it("distinguishes @scope/package@version (npm) from user/repo@tag (github)", () => {
			const npm = resolveKitSource("@facebook/react@18.0.0");
			expect(npm.type).toBe("npm");
			expect(npm.source).toBe("@facebook/react@18.0.0");

			const github = resolveKitSource("facebook/react@v18.0.0");
			expect(github.type).toBe("github");
			expect(github.source).toBe("github:facebook/react@v18.0.0");
		});

		it("distinguishes .git URLs from tarball URLs", () => {
			const git = resolveKitSource("https://example.com/repo.git");
			expect(git.type).toBe("git");

			const tarball = resolveKitSource("https://example.com/package.tgz");
			expect(tarball.type).toBe("url");
		});

		it("Windows drive letters take precedence over package names", () => {
			const windows = resolveKitSource("C:\\Projects\\my-kit");
			expect(windows.type).toBe("local");

			const package_ = resolveKitSource("my-kit");
			expect(package_.type).toBe("npm");
		});
	});

	describe("Real-World Scenarios", () => {
		it("handles complex GitHub URLs with branches and tags", () => {
			const branch = resolveKitSource("org/repo#feature-branch");
			expect(branch.type).toBe("github");
			expect(buildInstallCommand(branch, "bun", {})).toBe(
				"bun add 'github:org/repo#feature-branch'",
			);

			const tag = resolveKitSource("org/repo@v2.1.0");
			expect(tag.type).toBe("github");
			expect(buildInstallCommand(tag, "npm", {})).toBe("npm install 'github:org/repo@v2.1.0'");
		});

		it("handles npm packages with complex version specifiers", () => {
			const caret = resolveKitSource("@kit/nextjs@^1.0.0");
			expect(caret.type).toBe("npm");

			const tilde = resolveKitSource("my-kit@~2.3.0");
			expect(tilde.type).toBe("npm");

			const latest = resolveKitSource("some-kit@latest");
			expect(latest.type).toBe("npm");
		});

		it("handles monorepo local paths", () => {
			const relative = resolveKitSource("../../packages/my-kit");
			expect(relative.type).toBe("local");
			expect(buildInstallCommand(relative, "bun", {})).toBe("bun add '../../packages/my-kit'");
		});

		it("handles JSR packages for different package managers", () => {
			const jsr = resolveKitSource("jsr:@std/path");

			// Bun has native JSR support
			expect(buildInstallCommand(jsr, "bun", {})).toBe("bun add 'jsr:@std/path'");

			// Others use npx jsr add
			expect(buildInstallCommand(jsr, "npm", {})).toBe("npx jsr add @std/path");
			expect(buildInstallCommand(jsr, "pnpm", {})).toBe("npx jsr add @std/path");
			expect(buildInstallCommand(jsr, "yarn", {})).toBe("npx jsr add @std/path");
		});
	});

	describe("Error Cases", () => {
		it("rejects shell injection attempts", () => {
			const malicious = resolveKitSource("kit; rm -rf /");
			expect(() => buildInstallCommand(malicious, "bun", {})).toThrow("Invalid kit specifier");

			const pipe = resolveKitSource("kit | cat /etc/passwd");
			expect(() => buildInstallCommand(pipe, "npm", {})).toThrow("Invalid kit specifier");
		});

		it("handles edge cases gracefully", () => {
			// Whitespace
			const trimmed = resolveKitSource("  my-kit  ");
			expect(trimmed.source).toBe("my-kit");

			// Empty (should still resolve)
			const empty = resolveKitSource("");
			expect(empty.type).toBe("npm");
		});
	});
});
