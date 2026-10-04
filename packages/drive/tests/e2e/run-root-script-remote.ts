/**
 * Harness only: exercise the "run it for me" root-script path over a host:port
 * target, so scp copies the script and ssh runs it on the SAME non-default port.
 * Never shipped, never pointed at a real host. agent-user.sh owns the disposable
 * container, the throwaway key, the fake ssh/scp wrappers and all HOME/config.
 */
import { loadConfig } from "../../dist/config/index.js";
import { runSetup } from "../../dist/services/machine/runner.js";
import { agentUserCreate } from "../../dist/services/machine/tasks/agent-user-create.js";
import { RemoteMachine } from "../../dist/services/remote.js";

if (
	process.env.HYPER_T16_CONTAINER_TEST !== "1" ||
	!process.env.CLAUDE_CONFIG_DIR ||
	!process.env.HYPER_MACHINE_SCRATCH ||
	!process.env.HYPER_T16_PORT_TARGET
) {
	throw new Error(
		"Run only through agent-user.sh with its disposable container and isolated environment",
	);
}
const target = process.env.HYPER_T16_PORT_TARGET;
if (!/^svallory@localhost:\d+$/.test(target))
	throw new Error("Not the t16 host:port fixture target");
const config = loadConfig();
if (config.machines.t16?.home !== "/home/svallory") throw new Error("Not the t16 fixture config");
const runner = new RemoteMachine(target);
const marker = await runner.ssh(["cat", "/run/hyper-t16-fixture"]);
if (marker.code !== 0 || marker.stdout.trim() !== process.env.HYPER_T16_TOKEN)
	throw new Error("Not this harness's disposable container");
let choices = 0;
const report = await runSetup(
	{
		machine: {
			name: "t16",
			host: target,
			home: "/home/svallory",
			agentUser: "agent",
			agentKey: "",
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
		tasks: [agentUserCreate],
		prompt: {
			rootChoice: async () => {
				choices += 1;
				if (choices === 1) return "run-for-me";
				throw new Error("The task did not settle after the root script ran on the container");
			},
		},
		scratchDir: process.env.HYPER_MACHINE_SCRATCH,
	},
);
console.log(JSON.stringify(report));
if (report.failed.length || report.skipped.length || !report.applied.includes("agent-user.create"))
	process.exitCode = 1;
