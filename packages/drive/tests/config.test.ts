import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { configExists, configPath, loadConfig } from "#config/index";
import { DEFAULT_CONFIG } from "#config/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/drive.toml");
const MISSING = resolve(__dirname, "fixtures/does-not-exist.toml");

afterEach(() => {
	delete process.env.HYPER_DRIVE_CONFIG;
});

describe("configPath", () => {
	it("honours the HYPER_DRIVE_CONFIG override", () => {
		process.env.HYPER_DRIVE_CONFIG = FIXTURE;
		expect(configPath()).toBe(FIXTURE);
	});

	it("defaults to the user config dir", () => {
		delete process.env.HYPER_DRIVE_CONFIG;
		expect(configPath()).toBe(resolve(homedir(), ".config/hyper/drive.toml"));
	});
});

describe("loadConfig", () => {
	it("merges the fixture values over the defaults", () => {
		process.env.HYPER_DRIVE_CONFIG = FIXTURE;
		const config = loadConfig();

		expect(config.remote).toBe("git@github.com:example/hyperdrive.git");
		expect(config.self).toEqual({ name: "test-machine", home: "/home/tester" });
		expect(config.defaults.cadence).toBe("session-end");
		expect(config.machines.netcup).toEqual({
			home: "/home/svallory",
			features: ["docker", "mutagen"],
			agent_user: "agent",
		});
		expect(config.warp.exclude).toEqual(["node_modules", "dist"]);
		expect(config.sync.claude.ignore).toEqual(["projects/**/*.log"]);
		expect(config.sync.pi.ignore).toEqual(["sessions/**"]);
	});

	it("returns the defaults when the file is missing", () => {
		process.env.HYPER_DRIVE_CONFIG = MISSING;
		expect(configExists()).toBe(false);
		expect(loadConfig()).toEqual(DEFAULT_CONFIG);
	});
});
