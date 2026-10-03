import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceEntry } from "#config/schema";
import {
	isAllowedProjectUrl,
	isLocalDriveRemote,
	validateCloneEntry,
} from "#services/space-clone-validation";

let root: string;
const entry = (): SpaceEntry => ({
	name: "sample",
	group: null,
	branch: "space/sample",
	path: "/home/other/work/sample",
	layout: "bare",
	cadence: "manual",
	tracked: [],
	public: [],
	repos: [{ url: "https://example.invalid/project.git", default_branch: "main" }],
});
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "hyper-clone-validation-"));
	mkdirSync(join(root, "home"));
	for (const [key, value] of Object.entries({
		HOME: join(root, "home"),
		HYPER_HOME: join(root, "hyper"),
		HYPER_DRIVE_CONFIG: join(root, "drive.toml"),
		XDG_CONFIG_HOME: join(root, "config"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	}))
		vi.stubEnv(key, value);
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("selected manifest entry validation", () => {
	it.each([
		["name", "UPPER"],
		["group", "../bad"],
		["branch", "space/other"],
		["path", "/home/u/../../etc"],
		["path", "/home/u/a\nb"],
		["layout", "checkout"],
		["cadence", "always"],
		["tracked", ["scratch"]],
		["tracked", ["../outside"]],
		["tracked", [42]],
		["public", [42]],
		[
			"repos",
			[
				{ url: "https://example.invalid/a", default_branch: "main" },
				{ url: "https://example.invalid/b", default_branch: "main" },
			],
		],
	] as const)("rejects field %s with its name", (field, value) => {
		expect(() =>
			validateCloneEntry(
				{ ...entry(), [field]: value } as SpaceEntry,
				"https://example.invalid/drive",
			),
		).toThrow(field);
	});
	it.each(["$(x)", "-main", "main;cmd", "a..b", "a.lock", "a//b", "main\nother"])(
		"rejects unsafe default branch %j",
		(branch) => {
			const value = entry();
			value.repos[0].default_branch = branch;
			expect(() => validateCloneEntry(value, "https://example.invalid/drive")).toThrow(
				"repos[0].default_branch",
			);
		},
	);
	it.each(["main", "release/v1.2", "feature-abc_123"])("accepts safe branch %s", (branch) => {
		const value = entry();
		value.repos[0].default_branch = branch;
		expect(() => validateCloneEntry(value, "https://example.invalid/drive")).not.toThrow();
	});
	it.each(["/tmp/private.git", "../private.git", "file:///tmp/private.git"])(
		"refuses local project %s for hosted drives, accepts it only for a local drive",
		(url) => {
			const value = entry();
			value.repos[0].url = url;
			expect(() => validateCloneEntry(value, "https://example.invalid/drive")).toThrow(
				"repos[0].url",
			);
			expect(() => validateCloneEntry(value, join(root, "drive.git"))).not.toThrow();
		},
	);
	it.each([
		"https://user:password-value@example.invalid/project",
		"https://user:prefix@password-value@example.invalid/project",
		"https://user:password-value with spaces@example.invalid/project",
		"user:password-value@example.invalid:project",
	])("redacts all credentials in validation errors: %s", (url) => {
		const value = entry();
		value.repos[0].url = url;
		try {
			validateCloneEntry(value, "https://example.invalid/drive");
			throw new Error("should refuse");
		} catch (error) {
			expect(String(error)).toContain("repos[0].url");
			expect(String(error)).not.toContain("password-value");
		}
	});
	it.each([
		"ext::command",
		"custom::address",
		"git://example.invalid/repo",
		"ftp://example.invalid/repo",
		"--upload-pack=evil",
		"file://otherhost/private",
	])("rejects transport %s even for a local drive", (url) => {
		expect(isAllowedProjectUrl(url, true)).toBe(false);
	});
	it.each([
		"https://example.invalid/repo",
		"ssh://git@example.invalid/repo",
		"git@example.invalid:repo",
	])("allows %s", (url) => {
		expect(isAllowedProjectUrl(url, false)).toBe(true);
	});
	it("recognizes only local drive transports as the local trust domain", () => {
		for (const value of [join(root, "drive.git"), "../drive.git", "file:///tmp/drive.git"])
			expect(isLocalDriveRemote(value)).toBe(true);
		for (const value of ["https://example.invalid/drive", "git@example.invalid:drive", "ext::cmd"])
			expect(isLocalDriveRemote(value)).toBe(false);
	});
});
