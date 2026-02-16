import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Display content in an interactive pager (less).
 * Falls back to printing to stdout if less is not available.
 */
export function showInPager(content: string): Promise<void> {
	const tmpFile = join(tmpdir(), `hyper-diff-${Date.now()}.txt`);
	writeFileSync(tmpFile, content);

	return new Promise((resolve) => {
		// -R: interpret ANSI colors
		// -X: don't clear screen on exit
		// -K: allow Ctrl-C to exit
		const child = spawn("less", ["-RXK", tmpFile], {
			stdio: "inherit",
			env: {
				...process.env,
				LESS: "-RXK",
			},
		});

		child.on("close", () => {
			try {
				unlinkSync(tmpFile);
			} catch {}
			resolve();
		});

		child.on("error", () => {
			// less not available — print to stdout
			try {
				unlinkSync(tmpFile);
			} catch {}
			process.stdout.write(`${content}\n`);
			resolve();
		});
	});
}
