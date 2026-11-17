import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The pages the build must produce, relative to the output directory. */
const REQUIRED_PAGES = ["index.html", "pstack/playbooks/index.html"];

/** Returns the problems of an output directory; an empty list means it is good. */
export function assertDist(dir: string): string[] {
	const problems: string[] = [];
	for (const page of REQUIRED_PAGES) {
		const file = join(dir, page);
		if (!existsSync(file) || statSync(file).size === 0) {
			problems.push(`${page}: page is missing or empty`);
			continue;
		}
		if (readFileSync(file, "utf8").includes("data-content-error")) {
			problems.push(`${page}: page contains a content error (data-content-error)`);
		}
	}
	return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dir = fileURLToPath(new URL("../dist/public", import.meta.url));
	const problems = assertDist(dir);
	for (const problem of problems) console.error(`assert-dist: ${problem}`);
	process.exit(problems.length ? 1 : 0);
}
