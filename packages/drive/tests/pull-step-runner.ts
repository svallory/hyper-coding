/**
 * Test-only runner (never shipped, never a command): runs the BUILT pull with
 * an injected `onStep` that stops the process after one step, so a test can
 * signal it exactly at that boundary. The product has no environment switch
 * for this (review of PR #54, M2): only code that imports the service and
 * passes `onStep` can pause a pull.
 *
 * Usage: bun tests/pull-step-runner.ts <space root> <branch> <step> <marker file>
 */
import { writeFileSync } from "node:fs";
import { pullSpace } from "../dist/services/space-history.js";

const [root, branch, step, marker] = process.argv.slice(2);
if (!root || !branch || !step || !marker) {
	process.stderr.write("usage: pull-step-runner <root> <branch> <step> <marker>\n");
	process.exit(2);
}
await pullSpace(root, branch, {
	onStep(reached: string) {
		if (reached !== step) return;
		writeFileSync(marker, `${process.pid}\n`);
		// Wait to be killed; never resume on our own.
		for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
	},
});
process.stdout.write("pull finished without reaching the step\n");
