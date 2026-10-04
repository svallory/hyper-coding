/**
 * Harness only (docker-home.sh): open one session as the primary and one as the
 * agent through the SHIPPED runners, and print what each sees of the ssh-agent.
 * The harness's ssh config forwards a throwaway agent for this host; the
 * primary's session must see it (the fixture works) and the agent's must not
 * (OTHER_USER_SSH_OPTIONS). Never shipped.
 */
import { loadConfig } from "../../dist/config/index.js";
import { agentRunnerFor } from "../../dist/services/machine.js";
import { RemoteMachine } from "../../dist/services/remote.js";

if (process.env.HYPER_T17_CONTAINER_TEST !== "1" || !process.env.CLAUDE_CONFIG_DIR) {
	throw new Error("Run only through docker-home.sh with its disposable container");
}
const config = loadConfig();
if (config.machines.t17?.home !== "/Users/svallory") throw new Error("Not the t17 fixture config");

const probe = ["sh", "-c", 'echo "user=$(id -un) sock=${SSH_AUTH_SOCK:-unset}"'];
const primary = await new RemoteMachine("svallory@t17box").ssh(probe);
const agent = await agentRunnerFor(
	{
		name: "t17",
		host: "svallory@t17box",
		home: "/Users/svallory",
		agentUser: "agent",
		agentKey: "",
		features: [],
		source: "both",
		herdr: true,
	},
	"agent",
).ssh(probe);
console.log(`primary ${primary.code} ${primary.stdout.trim()}`);
console.log(`agent ${agent.code} ${agent.stdout.trim()}`);
