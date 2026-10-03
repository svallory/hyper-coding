/** Harness only: isolate dirs repair while the REAL watcher is stopped. Never shipped. */
import { loadConfig } from "../../dist/config/index.js";
import { runSetup } from "../../dist/services/machine/runner.js";
import { agentUserDirs } from "../../dist/services/machine/tasks/agent-user-dirs.js";
import { RemoteMachine } from "../../dist/services/remote.js";

if (
	process.env.HYPER_T16_CONTAINER_TEST !== "1" ||
	!process.env.CLAUDE_CONFIG_DIR ||
	!process.env.HYPER_MACHINE_SCRATCH
) {
	throw new Error(
		"Run only through agent-user.sh with its disposable container and isolated environment",
	);
}
const config = loadConfig();
if (config.machines.t16?.home !== "/home/svallory") throw new Error("Not the t16 fixture config");
const runner = new RemoteMachine("t16box");
const marker = await runner.ssh(["cat", "/run/hyper-t16-fixture"]);
if (marker.code !== 0 || marker.stdout.trim() !== process.env.HYPER_T16_TOKEN)
	throw new Error("Not this harness's disposable container");
const report = await runSetup(
	{
		machine: {
			name: "t16",
			host: "t16box",
			home: "/home/svallory",
			agentUser: "agent",
			features: ["agent-user"],
			source: "both",
			herdr: true,
		},
		config,
		runner,
		log: console.log,
	},
	{
		features: ["agent-user"],
		tasks: [agentUserDirs],
		prompt: {
			rootChoice: async () => {
				throw new Error("No root work in dirs repair");
			},
		},
		scratchDir: process.env.HYPER_MACHINE_SCRATCH,
	},
);
console.log(JSON.stringify(report));
if (report.failed.length || report.skipped.length || !report.applied.includes("agent-user.dirs"))
	process.exitCode = 1;
