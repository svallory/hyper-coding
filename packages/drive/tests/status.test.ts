import { afterEach, describe, expect, it, vi } from "vitest";
import Status from "#commands/drive/status";
import { ConfigError, loadConfig } from "#config/index";

/**
 * oclif's prettyPrint() returns `error.stack` verbatim when settings.debug (dev
 * mode), so a user-facing config error must reach this.error() without JS frames.
 */
function runStatus(debug = false): Promise<{ thrown: unknown }> {
	const command = new Status([], {} as never);
	const self = command as any;
	self.flags = { debug };
	self.parse = async () => ({ flags: { debug }, args: {}, raw: [] });
	self.log = () => {};

	let thrown: unknown;
	self.error = (err: unknown) => {
		thrown = err;
	};
	return command.run().then(() => ({ thrown }));
}

afterEach(() => {
	vi.restoreAllMocks();
	delete process.env.HYPER_DRIVE_CONFIG;
});

describe("drive status error handling", () => {
	it("surfaces a config error without any stack frames", async () => {
		const err = new ConfigError("/tmp/drive.toml", "`self` must be a section.");
		vi.spyOn(await import("#config/index"), "loadConfig").mockImplementation(() => {
			throw err;
		});

		const { thrown } = await runStatus();
		const error = thrown as Error;

		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe(err.message);
		expect(error.stack ?? "").not.toContain("\n    at ");
	});

	it("keeps the stack when the user passes --debug", async () => {
		const err = new ConfigError("/tmp/drive.toml", "`self` must be a section.");
		vi.spyOn(await import("#config/index"), "loadConfig").mockImplementation(() => {
			throw err;
		});

		const { thrown } = await runStatus(true);

		expect((thrown as Error).stack ?? "").toContain("    at ");
	});

	it("rethrows a non-config error unchanged so real bugs stay visible", async () => {
		const bug = new TypeError("p.startsWith is not a function");
		vi.spyOn(await import("#config/index"), "loadConfig").mockImplementation(() => {
			throw bug;
		});

		await expect(runStatus()).rejects.toBe(bug);
		expect(bug).not.toBeInstanceOf(ConfigError);
		expect(loadConfig).toBeDefined();
	});
});
