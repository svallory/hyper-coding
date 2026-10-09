import { describe, expect, it } from "vitest";
import { expandRemote, type Forge, parseForgeRemote } from "#services/forge";

const github: Forge = { provider: "github", host: "github.com", user: "ada" };
const gitlab: Forge = { provider: "gitlab", host: "gitlab.com", user: "ada" };

describe("expandRemote", () => {
	it("turns owner/name into an SSH URL on the forge", () => {
		expect(expandRemote("ada/hyperdrive", github)).toBe("git@github.com:ada/hyperdrive.git");
		expect(expandRemote("team/hyperdrive", gitlab)).toBe("git@gitlab.com:team/hyperdrive.git");
	});

	it("fills a bare name with the logged-in user", () => {
		expect(expandRemote("hyperdrive", github)).toBe("git@github.com:ada/hyperdrive.git");
		expect(expandRemote("hyperdrive.git", github)).toBe("git@github.com:ada/hyperdrive.git");
	});

	it("assumes github.com for owner/name when nobody is logged in", () => {
		expect(expandRemote("ada/hyperdrive", null)).toBe("git@github.com:ada/hyperdrive.git");
	});

	it("leaves a bare name alone when there is no user to own it", () => {
		expect(expandRemote("hyperdrive", null)).toBe("hyperdrive");
	});

	it("leaves URLs and paths untouched", () => {
		for (const value of [
			"git@github.com:ada/hyperdrive.git",
			"ssh://git@github.com/ada/hyperdrive.git",
			"https://github.com/ada/hyperdrive",
			"/srv/git/hyperdrive.git",
			"./hyperdrive.git",
			"~/hyperdrive.git",
			"../up/hyperdrive",
			"host:hyperdrive.git",
		]) {
			expect(expandRemote(value, github)).toBe(value);
		}
	});

	it("refuses to invent a URL from something that is not a name", () => {
		expect(expandRemote("a/b/c", github)).toBe("a/b/c");
		expect(expandRemote("-dash/repo", github)).toBe("-dash/repo");
		expect(expandRemote("", github)).toBe("");
	});
});

describe("parseForgeRemote", () => {
	it("reads github and gitlab repositories from SSH and HTTPS URLs", () => {
		expect(parseForgeRemote("git@github.com:ada/hyperdrive.git")).toEqual({
			provider: "github",
			host: "github.com",
			owner: "ada",
			name: "hyperdrive",
		});
		expect(parseForgeRemote("ssh://git@gitlab.com/team/hyperdrive")).toEqual({
			provider: "gitlab",
			host: "gitlab.com",
			owner: "team",
			name: "hyperdrive",
		});
		expect(parseForgeRemote("https://github.com/ada/hyperdrive")).toMatchObject({
			provider: "github",
			owner: "ada",
			name: "hyperdrive",
		});
	});

	it("answers null for paths and unknown hosts", () => {
		expect(parseForgeRemote("/srv/git/hyperdrive.git")).toBeNull();
		expect(parseForgeRemote("git@git.example.com:ada/hyperdrive.git")).toBeNull();
		expect(parseForgeRemote("hyperdrive")).toBeNull();
	});
});
