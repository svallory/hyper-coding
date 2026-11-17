import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, type PageName, pageFile, readSite } from "./lib/read-site";

const app = fileURLToPath(new URL("..", import.meta.url));
const dist = join(app, "dist/public");
const write = process.argv.includes("--write");

const inventories = Object.fromEntries(
	(Object.keys(PAGES) as PageName[]).map((page) => {
		const file = pageFile(dist, page);
		if (!existsSync(file)) {
			console.error(`inventory: ${file} is missing; run the build first.`);
			process.exit(1);
		}
		return [page, readSite(readFileSync(file, "utf8"), page)];
	}),
);

console.log(JSON.stringify(inventories, null, 2));

if (write) {
	// Only the expected files that exist are refreshed: a page without one is not compared.
	for (const [page, inventory] of Object.entries(inventories)) {
		const expected = join(app, "tests/expected", `inventory.${page}.json`);
		if (existsSync(expected)) {
			writeFileSync(expected, `${JSON.stringify(inventory, null, "\t")}\n`);
			// The repository's formatter keeps short arrays on one line; the commit hook would
			// apply it anyway, so apply it here and a second --write changes nothing.
			const r = spawnSync("bunx", ["biome", "format", "--write", expected], {
				cwd: app,
				stdio: ["ignore", "ignore", "inherit"],
			});
			if (r.error || r.status !== 0) {
				console.error(
					`inventory: could not format ${expected} with biome (exit ${r.status ?? r.signal}); the file is written but unformatted.`,
				);
				process.exit(1);
			}
		}
	}
}
