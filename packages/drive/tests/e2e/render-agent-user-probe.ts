/** Render only: no runner execution or config reads. Optional output is a harness temp file. */
import { writeFileSync } from "node:fs";
import { agentUserDirs } from "../../dist/services/machine/tasks/agent-user-dirs.js";

await agentUserDirs.check({
	machine: {
		name: "t16",
		host: "t16box",
		home: "/home/svallory",
		agentUser: "agent",
		features: [],
		source: "both",
		herdr: true,
	},
	config: {
		remote: "git@example.invalid:fixture.git",
		self: { name: "fixture", home: "/fixture" },
		defaults: { cadence: "manual" },
		machines: {},
		warp: { exclude: [] },
		sync: { claude: { ignore: [] }, pi: { ignore: [] } },
	},
	log: () => {},
	runner: {
		async scp() {
			throw new Error("probe must not copy anything");
		},
		async rsync() {
			throw new Error("probe must not copy anything");
		},
		async ssh(argv: string[]) {
			const script = argv[2];
			if (script.includes("unprotected_top")) {
				// A version-manager shim may print notices on stdout. Never let those
				// become commands in the probe copied to the container.
				if (process.argv[2]) writeFileSync(process.argv[2], script);
				else process.stdout.write(script);
			}
			return {
				code: 0,
				stdout: script.startsWith("getent passwd") ? "/home/agent\n" : "",
				stderr: "",
			};
		},
	},
});
