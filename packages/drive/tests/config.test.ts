import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { configExists, configPath, loadConfig } from "#config/index";
import { DEFAULT_CONFIG, DEFAULT_MACHINE } from "#config/schema";
import { withTempConfig } from "#tests/tmp-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/drive.toml");
const PARTIAL = resolve(__dirname, "fixtures/drive-partial.toml");
const MALFORMED = resolve(__dirname, "fixtures/drive-malformed.toml");
const MISSING = resolve(__dirname, "fixtures/does-not-exist.toml");
const fixture = (name: string) => resolve(__dirname, "fixtures", name);

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
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-tilde.toml");
		const config = loadConfig();

		expect(config.self.home).toBe(resolve(homedir(), "self"));
		expect(config.machines.spare?.home).toBe(resolve(homedir(), "spare"));
	});

	it("expands a bare ~ to the home dir", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-tilde.toml");
		expect(loadConfig().machines.bare?.home).toBe(homedir());
	});

	it("falls back to homedir() when self.home is empty", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-empty-home.toml");
		expect(loadConfig().self.home).toBe(homedir());
	});

	it("does not alias or mutate DEFAULT_CONFIG when the file omits tables", () => {
		// No [self] and no [warp] in the file: these keys must come from a clone,
		// not by reference to the module defaults.
		withTempConfig('remote = "git@github.com:example/omitted.git"\n');
		const config = loadConfig();

		expect(config.self).not.toBe(DEFAULT_CONFIG.self);
		expect(config.warp.exclude).not.toBe(DEFAULT_CONFIG.warp.exclude);
		expect(config.sync.claude.ignore).not.toBe(DEFAULT_CONFIG.sync.claude.ignore);

		// Writing through the result must not reach the defaults
		config.self.home = "/tmp/mutated";
		config.warp.exclude.push("mutated");
		config.sync.claude.ignore.push("mutated");

		expect(DEFAULT_CONFIG.self.home).not.toBe("/tmp/mutated");
		expect(DEFAULT_CONFIG.warp.exclude).toHaveLength(8);
		expect(DEFAULT_CONFIG.sync.claude.ignore).toEqual([]);
	});

	it("does not share one features array between machines", () => {
		withTempConfig('[machines.a]\nhome = "/a"\n\n[machines.b]\nhome = "/b"\n');
		const config = loadConfig();

		expect(config.machines.a.features).toEqual(DEFAULT_MACHINE.features);
		expect(config.machines.b.features).toEqual(DEFAULT_MACHINE.features);
		expect(config.machines.a.features).not.toBe(config.machines.b.features);

		config.machines.a.features.push("docker");
		expect(config.machines.b.features).toEqual([]);
		expect(DEFAULT_MACHINE.features).toEqual([]);
	});

	it("throws a friendly error when a section is a scalar", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-bad-table.toml");
		expect(() => loadConfig()).toThrowError(/`self` must be a section/);
	});

	it("throws a friendly error when remote is not a string", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-bad-remote.toml");
		expect(() => loadConfig()).toThrowError(/`remote` must be a string/);
	});

	it("throws a friendly error when a machine entry is a scalar", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-bad-machine.toml");
		expect(() => loadConfig()).toThrowError(/`machines.x` must be a section/);
	});

	it("throws a friendly error when machine features is not a string list", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-bad-features.toml");
		expect(() => loadConfig()).toThrowError(/`machines\.x\.features` must be a list of strings/);
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
			// The smol-toml code frame (source line + caret) must survive into the message
			expect(message).toMatch(/\d+:\s+remote =/);
			expect(message).toContain("^");
			// Friendly error, not a raw thrown TomlError
			expect(message.startsWith("There's a problem")).toBe(true);
		}
	});

	it("throws a friendly error on an unreadable path (directory)", () => {
		process.env.HYPER_DRIVE_CONFIG = __dirname;
		expect(() => loadConfig()).toThrowError(/hyperdrive config at/);
	});

	it("throws a friendly error on an invalid cadence", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-bad-cadence.toml");
		expect(() => loadConfig()).toThrowError(/defaults\.cadence must be one of/);
	});

	it("throws a friendly error when warp.exclude is not a string list", () => {
		process.env.HYPER_DRIVE_CONFIG = fixture("drive-bad-exclude.toml");
		expect(() => loadConfig()).toThrowError(/warp\.exclude.*list of strings/);
	});

	describe("type errors", () => {
		it("rejects a non-string self.home", () => {
			withTempConfig("[self]\nhome = 5\n");
			expect(() => loadConfig()).toThrowError(/`self\.home` must be a string, but it is a number/);
		});

		it("rejects a boolean self.home instead of silently using homedir()", () => {
			withTempConfig("[self]\nhome = false\n");
			expect(() => loadConfig()).toThrowError(/`self\.home` must be a string, but it is a boolean/);
		});

		it("rejects a list self.home before expandHome crashes", () => {
			withTempConfig('[self]\nhome = ["a"]\n');
			expect(() => loadConfig()).toThrowError(/`self\.home` must be a string, but it is a list/);
		});

		it("rejects a non-string self.name", () => {
			withTempConfig("[self]\nname = 5\n");
			expect(() => loadConfig()).toThrowError(/`self\.name` must be a string/);
		});

		it("rejects a non-string machine agent_user", () => {
			withTempConfig("[machines.x]\nagent_user = 5\n");
			expect(() => loadConfig()).toThrowError(
				/`machines\.x\.agent_user` must be a string, but it is a number/,
			);
		});

		it("rejects a non-string machine home", () => {
			withTempConfig("[machines.x]\nhome = 5\n");
			expect(() => loadConfig()).toThrowError(
				/`machines\.x\.home` must be a string, but it is a number/,
			);
		});

		it("rejects a date where a section is expected", () => {
			withTempConfig("self = 1979-05-27\n");
			expect(() => loadConfig()).toThrowError(/`self` must be a section, but it is a date/);
		});

		it("rejects a scalar sync target", () => {
			withTempConfig('[sync]\nclaude = "x"\n');
			expect(() => loadConfig()).toThrowError(/`sync\.claude` must be a section/);
		});

		it("rejects a non-string sync.pi.ignore list", () => {
			withTempConfig('[sync.pi]\nignore = "nope"\n');
			expect(() => loadConfig()).toThrowError(/`sync\.pi\.ignore` must be a list of strings/);
		});
	});
});
