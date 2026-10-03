import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { configExists, configPath, loadConfig } from "#config/index";
import { DEFAULT_CONFIG, DEFAULT_MACHINE } from "#config/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/drive.toml");
const PARTIAL = resolve(__dirname, "fixtures/drive-partial.toml");
const MALFORMED = resolve(__dirname, "fixtures/drive-malformed.toml");
const MISSING = resolve(__dirname, "fixtures/does-not-exist.toml");

afterEach(() => {
	delete process.env.HYPER_DRIVE_CONFIG;
});

describe("configPath", () => {
	it("honours the HYPER_DRIVE_CONFIG override", () => {
		process.env.HYPER_DRIVE_CONFIG = FIXTURE;
		expect(configPath()).toBe(FIXTURE);
	});

	it("resolves a relative override to an absolute path", () => {
		process.env.HYPER_DRIVE_CONFIG = "tests/fixtures/drive.toml";
		expect(configPath()).toBe(resolve("tests/fixtures/drive.toml"));
	});

	it("treats an empty override as unset", () => {
		process.env.HYPER_DRIVE_CONFIG = "";
		expect(configPath()).toBe(resolve(homedir(), ".config/hyper/drive.toml"));
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

	it("fills per-machine defaults when a machine omits them", () => {
		process.env.HYPER_DRIVE_CONFIG = FIXTURE;
		const config = loadConfig();

		// [machines.spare] in the fixture only sets `home`
		expect(config.machines.spare).toEqual({
			home: "/home/spare",
			features: DEFAULT_MACHINE.features,
			agent_user: "agent",
		});
	});

	it("merges a partial fixture over the defaults", () => {
		process.env.HYPER_DRIVE_CONFIG = PARTIAL;
		const config = loadConfig();

		// Overridden keys hold the fixture values
		expect(config.remote).toBe("git@github.com:example/partial-drive.git");
		expect(config.self.name).toBe("partial-machine");

		// Everything else comes from the defaults
		expect(config.self.home).toBe(homedir());
		expect(config.warp.exclude).toEqual(DEFAULT_CONFIG.warp.exclude);
		expect(config.defaults.cadence).toBe("");
		expect(config.sync.pi.ignore).toEqual([]);
		expect(config.sync.claude.ignore).toEqual([]);
		expect(config.machines).toEqual({});
	});

	it("returns the defaults when the file is missing", () => {
		process.env.HYPER_DRIVE_CONFIG = MISSING;
		expect(configExists()).toBe(false);
		expect(loadConfig()).toEqual({
			...DEFAULT_CONFIG,
			self: { ...DEFAULT_CONFIG.self, home: homedir() },
		});
	});

	it("expands a leading ~/ in self.home and machines.*.home", () => {
		process.env.HYPER_DRIVE_CONFIG = FIXTURE;
		const config = loadConfig();

		// [machines.laptop] in the fixture uses "~/"
		expect(config.machines.laptop?.home).toBe(resolve(homedir(), "alice"));
	});

	it("throws a friendly error naming the file on malformed TOML", () => {
		process.env.HYPER_DRIVE_CONFIG = MALFORMED;
		expect(() => loadConfig()).toThrowError(
			new RegExp(`hyperdrive config at ${MALFORMED.replaceAll("/", "\\/")}`),
		);
		try {
			loadConfig();
			expect.unreachable();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			expect(message).toContain("TOML");
			// Friendly error: the smol-toml message (with line/column) is embedded,
			// not thrown raw as the top-level message
			expect(message.startsWith("There's a problem")).toBe(true);
		}
	});

	it("throws a friendly error on an unreadable path (directory)", () => {
		process.env.HYPER_DRIVE_CONFIG = __dirname;
		expect(() => loadConfig()).toThrowError(/hyperdrive config at/);
	});

	it("throws a friendly error on an invalid cadence", () => {
		process.env.HYPER_DRIVE_CONFIG = resolve(__dirname, "fixtures/drive-bad-cadence.toml");
		expect(() => loadConfig()).toThrowError(/defaults\.cadence must be one of/);
	});

	it("throws a friendly error when warp.exclude is not a string list", () => {
		process.env.HYPER_DRIVE_CONFIG = resolve(__dirname, "fixtures/drive-bad-exclude.toml");
		expect(() => loadConfig()).toThrowError(/warp\.exclude.*list of strings/);
	});
});
