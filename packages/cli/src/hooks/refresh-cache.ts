import type { Hook } from "@oclif/core";

const hook: Hook<"plugins:postinstall"> = async (opts) => {
	try {
		await opts.config.runCommand("autocomplete:create");
	} catch {
		// Silently fail — don't block kit install/uninstall
	}
};

export default hook;
