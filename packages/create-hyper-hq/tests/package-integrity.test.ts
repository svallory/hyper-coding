import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_ROOT = resolve(import.meta.dirname, "..");
const DIST_INDEX = resolve(PKG_ROOT, "dist/index.js");
const PKG_JSON = JSON.parse(readFileSync(resolve(PKG_ROOT, "package.json"), "utf-8"));

describe("Package integrity", () => {
	describe("bin entry point", () => {
		it("dist/index.js exists", () => {
			expect(existsSync(DIST_INDEX)).toBe(true);
		});

		it("has a shebang as the first line", () => {
			const content = readFileSync(DIST_INDEX, "utf-8");
			const firstLine = content.split("\n")[0];
			expect(firstLine).toBe("#!/usr/bin/env node");
		});

		it("has exactly one shebang (no duplicates)", () => {
			const content = readFileSync(DIST_INDEX, "utf-8");
			const shebangs = content.split("\n").filter((line) => line.startsWith("#!"));
			expect(shebangs).toHaveLength(1);
		});

		it("is executable", () => {
			const stats = statSync(DIST_INDEX);
			const isExecutable = (stats.mode & 0o111) !== 0;
			expect(isExecutable).toBe(true);
		});

		it("can be executed with node without errors", () => {
			// Run with --help or just check it starts without crashing
			// We send EOF immediately via stdin to avoid interactive prompts
			const result = spawnSync("node", [DIST_INDEX], {
				input: "",
				timeout: 5000,
				encoding: "utf-8",
			});
			// The wizard will exit when stdin closes, but it shouldn't crash
			// Exit code 0 or 1 (cancelled) is fine — anything else is a crash
			expect(result.status).toBeLessThanOrEqual(1);
			expect(result.stderr).not.toContain("SyntaxError");
			expect(result.stderr).not.toContain("Cannot find module");
		});
	});

	describe("package.json", () => {
		it("has a bin entry pointing to dist/index.js", () => {
			expect(PKG_JSON.bin).toBeDefined();
			expect(PKG_JSON.bin["create-hyper-hq"]).toBe("./dist/index.js");
		});

		it("includes dist in files array", () => {
			expect(PKG_JSON.files).toContain("dist");
		});

		it("has publishConfig with public access", () => {
			expect(PKG_JSON.publishConfig?.access).toBe("public");
		});

		it("has no workspace:* dependencies", () => {
			for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
				const deps = PKG_JSON[depField] ?? {};
				for (const [name, version] of Object.entries(deps)) {
					expect(
						(version as string).includes("workspace:"),
						`${depField}.${name} contains workspace: protocol`,
					).toBe(false);
				}
			}
		});
	});

	describe("npm pack simulation", () => {
		it("npm pack includes dist/index.js", () => {
			const result = execFileSync("npm", ["pack", "--dry-run", "--json"], {
				cwd: PKG_ROOT,
				encoding: "utf-8",
				timeout: 30000,
			});
			const packInfo = JSON.parse(result);
			const files = packInfo[0].files.map((f: { path: string }) => f.path);
			expect(files).toContainEqual("dist/index.js");
		});

		it("npm pack includes package.json", () => {
			const result = execFileSync("npm", ["pack", "--dry-run", "--json"], {
				cwd: PKG_ROOT,
				encoding: "utf-8",
				timeout: 30000,
			});
			const packInfo = JSON.parse(result);
			const files = packInfo[0].files.map((f: { path: string }) => f.path);
			expect(files).toContainEqual("package.json");
		});
	});
});
