import { describe, expect, it } from "vitest";
import { buildInstallCommand, resolveKitSource } from "#/source-resolver";

describe("Kit Source Resolver", () => {
	describe("NPM Packages", () => {
		it("resolves unscoped npm package", () => {
			const result = resolveKitSource("my-kit");
			expect(result).toEqual({
				type: "npm",
				source: "my-kit",
				original: "my-kit",
				registry: "npm",
			});
		});

		it("resolves scoped npm package", () => {
			const result = resolveKitSource("@kit/nextjs");
			expect(result).toEqual({
				type: "npm",
				source: "@kit/nextjs",
				original: "@kit/nextjs",
				registry: "npm",
			});
		});

		it("resolves npm package with version", () => {
			const result = resolveKitSource("my-kit@1.2.3");
			expect(result).toEqual({
				type: "npm",
				source: "my-kit@1.2.3",
				original: "my-kit@1.2.3",
				registry: "npm",
			});
		});

		it("resolves scoped npm package with version", () => {
			const result = resolveKitSource("@kit/nextjs@^1.0.0");
			expect(result).toEqual({
				type: "npm",
				source: "@kit/nextjs@^1.0.0",
				original: "@kit/nextjs@^1.0.0",
				registry: "npm",
			});
		});

		it("resolves npm package with explicit prefix", () => {
			const result = resolveKitSource("npm:@kit/nextjs");
			expect(result).toEqual({
				type: "npm",
				source: "@kit/nextjs",
				original: "npm:@kit/nextjs",
				registry: "npm",
			});
		});
	});

	describe("JSR Packages", () => {
		it("resolves JSR package with jsr: prefix", () => {
			const result = resolveKitSource("jsr:@std/path");
			expect(result).toEqual({
				type: "jsr",
				source: "jsr:@std/path",
				original: "jsr:@std/path",
				registry: "jsr",
			});
		});

		it("resolves JSR package with @jsr/ pattern", () => {
			const result = resolveKitSource("@jsr/std__path");
			expect(result).toEqual({
				type: "jsr",
				source: "@jsr/std__path",
				original: "@jsr/std__path",
				registry: "jsr",
			});
		});
	});

	describe("GitHub Shorthand", () => {
		it("resolves GitHub shorthand", () => {
			const result = resolveKitSource("svallory/hypergen-kit-nextjs");
			expect(result).toEqual({
				type: "github",
				source: "github:svallory/hypergen-kit-nextjs",
				original: "svallory/hypergen-kit-nextjs",
			});
		});

		it("resolves GitHub shorthand with branch", () => {
			const result = resolveKitSource("svallory/hypergen-kit-nextjs#develop");
			expect(result).toEqual({
				type: "github",
				source: "github:svallory/hypergen-kit-nextjs#develop",
				original: "svallory/hypergen-kit-nextjs#develop",
			});
		});

		it("resolves GitHub shorthand with tag", () => {
			const result = resolveKitSource("svallory/hypergen-kit-nextjs@v1.0.0");
			expect(result).toEqual({
				type: "github",
				source: "github:svallory/hypergen-kit-nextjs@v1.0.0",
				original: "svallory/hypergen-kit-nextjs@v1.0.0",
			});
		});

		it("resolves explicit github: prefix", () => {
			const result = resolveKitSource("github:svallory/hypergen-kit-nextjs");
			expect(result).toEqual({
				type: "github",
				source: "github:svallory/hypergen-kit-nextjs",
				original: "github:svallory/hypergen-kit-nextjs",
			});
		});

		it("does not treat scoped npm packages as GitHub shorthand", () => {
			const result = resolveKitSource("@facebook/react@18.0.0");
			expect(result.type).toBe("npm");
		});
	});

	describe("GitLab and Bitbucket", () => {
		it("resolves GitLab prefix", () => {
			const result = resolveKitSource("gitlab:username/my-kit");
			expect(result).toEqual({
				type: "gitlab",
				source: "gitlab:username/my-kit",
				original: "gitlab:username/my-kit",
			});
		});

		it("resolves Bitbucket prefix", () => {
			const result = resolveKitSource("bitbucket:username/my-kit");
			expect(result).toEqual({
				type: "bitbucket",
				source: "bitbucket:username/my-kit",
				original: "bitbucket:username/my-kit",
			});
		});
	});

	describe("Git URLs", () => {
		it("resolves HTTPS .git URL", () => {
			const result = resolveKitSource("https://github.com/user/repo.git");
			expect(result).toEqual({
				type: "git",
				source: "https://github.com/user/repo.git",
				original: "https://github.com/user/repo.git",
			});
		});

		it("resolves git:// URL", () => {
			const result = resolveKitSource("git://github.com/user/repo.git");
			expect(result).toEqual({
				type: "git",
				source: "git://github.com/user/repo.git",
				original: "git://github.com/user/repo.git",
			});
		});

		it("resolves ssh://git@ URL", () => {
			const result = resolveKitSource("ssh://git@github.com/user/repo.git");
			expect(result).toEqual({
				type: "git",
				source: "ssh://git@github.com/user/repo.git",
				original: "ssh://git@github.com/user/repo.git",
			});
		});

		it("resolves git+ prefix", () => {
			const result = resolveKitSource("git+https://github.com/user/repo.git");
			expect(result).toEqual({
				type: "git",
				source: "git+https://github.com/user/repo.git",
				original: "git+https://github.com/user/repo.git",
			});
		});

		it("resolves git+ssh prefix", () => {
			const result = resolveKitSource("git+ssh://git@github.com/user/repo.git");
			expect(result).toEqual({
				type: "git",
				source: "git+ssh://git@github.com/user/repo.git",
				original: "git+ssh://git@github.com/user/repo.git",
			});
		});
	});

	describe("HTTP(S) URLs", () => {
		it("resolves tarball URL as url type", () => {
			const result = resolveKitSource("https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz");
			expect(result).toEqual({
				type: "url",
				source: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
				original: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
			});
		});

		it("resolves .git URL as git type even with https://", () => {
			const result = resolveKitSource("https://example.com/repo.git");
			expect(result.type).toBe("git");
		});
	});

	describe("Unix Paths", () => {
		it("resolves relative path with ./", () => {
			const result = resolveKitSource("./my-local-kit");
			expect(result).toEqual({
				type: "local",
				source: "./my-local-kit",
				original: "./my-local-kit",
			});
		});

		it("resolves parent path with ../", () => {
			const result = resolveKitSource("../sibling-kit");
			expect(result).toEqual({
				type: "local",
				source: "../sibling-kit",
				original: "../sibling-kit",
			});
		});

		it("resolves absolute path", () => {
			const result = resolveKitSource("/absolute/path/to/kit");
			expect(result).toEqual({
				type: "local",
				source: "/absolute/path/to/kit",
				original: "/absolute/path/to/kit",
			});
		});

		it("resolves home directory path", () => {
			const result = resolveKitSource("~/projects/my-kit");
			expect(result).toEqual({
				type: "local",
				source: "~/projects/my-kit",
				original: "~/projects/my-kit",
			});
		});

		it("resolves file: prefix", () => {
			const result = resolveKitSource("file:./my-kit");
			expect(result).toEqual({
				type: "local",
				source: "file:./my-kit",
				original: "file:./my-kit",
			});
		});
	});

	describe("Windows Paths", () => {
		it("resolves Windows drive letter with backslash", () => {
			const result = resolveKitSource("C:\\Projects\\my-kit");
			expect(result).toEqual({
				type: "local",
				source: "C:\\Projects\\my-kit",
				original: "C:\\Projects\\my-kit",
			});
		});

		it("resolves Windows drive letter with forward slash", () => {
			const result = resolveKitSource("C:/Projects/my-kit");
			expect(result).toEqual({
				type: "local",
				source: "C:/Projects/my-kit",
				original: "C:/Projects/my-kit",
			});
		});

		it("resolves Windows relative path with backslash", () => {
			const result = resolveKitSource(".\\my-local-kit");
			expect(result).toEqual({
				type: "local",
				source: ".\\my-local-kit",
				original: ".\\my-local-kit",
			});
		});

		it("resolves Windows parent path with backslash", () => {
			const result = resolveKitSource("..\\sibling-kit");
			expect(result).toEqual({
				type: "local",
				source: "..\\sibling-kit",
				original: "..\\sibling-kit",
			});
		});

		it("resolves Windows UNC path", () => {
			const result = resolveKitSource("\\\\server\\share\\kit");
			expect(result).toEqual({
				type: "local",
				source: "\\\\server\\share\\kit",
				original: "\\\\server\\share\\kit",
			});
		});

		it("resolves lowercase drive letter", () => {
			const result = resolveKitSource("d:\\kits\\my-kit");
			expect(result.type).toBe("local");
		});
	});

	describe("Edge Cases", () => {
		it("trims whitespace", () => {
			const result = resolveKitSource("  my-kit  ");
			expect(result.source).toBe("my-kit");
		});

		it("handles hyphens in package names", () => {
			const result = resolveKitSource("my-awesome-kit");
			expect(result.type).toBe("npm");
		});

		it("handles underscores in package names", () => {
			const result = resolveKitSource("my_kit");
			expect(result.type).toBe("npm");
		});

		it("handles dots in package names", () => {
			const result = resolveKitSource("my.kit");
			expect(result.type).toBe("npm");
		});

		it("handles numbers in GitHub usernames", () => {
			const result = resolveKitSource("user123/repo456");
			expect(result.type).toBe("github");
		});
	});

	describe("buildInstallCommand", () => {
		it("builds bun command for npm package", () => {
			const resolved = resolveKitSource("@kit/nextjs");
			const cmd = buildInstallCommand(resolved, "bun", {});
			expect(cmd).toBe("bun add '@kit/nextjs'");
		});

		it("builds bun command with --dev flag", () => {
			const resolved = resolveKitSource("@kit/nextjs");
			const cmd = buildInstallCommand(resolved, "bun", { dev: true });
			expect(cmd).toBe("bun add -d '@kit/nextjs'");
		});

		it("builds bun command with --global flag", () => {
			const resolved = resolveKitSource("@kit/nextjs");
			const cmd = buildInstallCommand(resolved, "bun", { global: true });
			expect(cmd).toBe("bun add -g '@kit/nextjs'");
		});

		it("builds pnpm command", () => {
			const resolved = resolveKitSource("@kit/nextjs");
			const cmd = buildInstallCommand(resolved, "pnpm", {});
			expect(cmd).toBe("pnpm add '@kit/nextjs'");
		});

		it("builds yarn command", () => {
			const resolved = resolveKitSource("@kit/nextjs");
			const cmd = buildInstallCommand(resolved, "yarn", {});
			expect(cmd).toBe("yarn add '@kit/nextjs'");
		});

		it("builds npm command", () => {
			const resolved = resolveKitSource("@kit/nextjs");
			const cmd = buildInstallCommand(resolved, "npm", {});
			expect(cmd).toBe("npm install '@kit/nextjs'");
		});

		it("builds GitHub command", () => {
			const resolved = resolveKitSource("svallory/hypergen-kit-nextjs");
			const cmd = buildInstallCommand(resolved, "bun", {});
			expect(cmd).toBe("bun add 'github:svallory/hypergen-kit-nextjs'");
		});

		it("builds local path command", () => {
			const resolved = resolveKitSource("./my-kit");
			const cmd = buildInstallCommand(resolved, "bun", {});
			expect(cmd).toBe("bun add './my-kit'");
		});

		it("builds JSR command for bun (native support)", () => {
			const resolved = resolveKitSource("jsr:@std/path");
			const cmd = buildInstallCommand(resolved, "bun", {});
			expect(cmd).toBe("bun add 'jsr:@std/path'");
		});

		it("builds JSR command for npm (uses npx jsr add)", () => {
			const resolved = resolveKitSource("jsr:@std/path");
			const cmd = buildInstallCommand(resolved, "npm", {});
			expect(cmd).toBe("npx jsr add @std/path");
		});

		it("escapes single quotes in sources", () => {
			const resolved = resolveKitSource("kit-with-'quote");
			const cmd = buildInstallCommand(resolved, "bun", {});
			expect(cmd).toContain("'kit-with-'\\''quote'");
		});

		it("rejects shell injection characters", () => {
			const resolved = resolveKitSource("kit; rm -rf /");
			expect(() => buildInstallCommand(resolved, "bun", {})).toThrow("Invalid kit specifier");
		});

		it("rejects pipe characters", () => {
			const resolved = resolveKitSource("kit | cat");
			expect(() => buildInstallCommand(resolved, "bun", {})).toThrow("Invalid kit specifier");
		});

		it("rejects backticks", () => {
			const resolved = resolveKitSource("kit`whoami`");
			expect(() => buildInstallCommand(resolved, "bun", {})).toThrow("Invalid kit specifier");
		});
	});
});
