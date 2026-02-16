import path from "node:path";
import { Logger } from "@hypercli/core";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import add from "#/ops/add";

describe("add", () => {
	const logger = new Logger(console.log);

	it("should add a new file", async () => {
		const CWD = "/tmp/add-new-file";
		fs.removeSync(CWD);
		const to = path.join(CWD, "app/hello.js");

		const result = await add(
			{
				attributes: { to: "app/hello.js" },
				body: "hello",
			},
			{},
			{
				logger,
				cwd: CWD,
			},
		);

		expect(result).toMatchSnapshot({ timing: expect.any(Number) });
		expect(fs.existsSync(to)).toBe(true);
		expect(fs.readFileSync(to).toString()).toBe("hello");
		fs.removeSync(CWD);
	});

	it("should overwrite an existing file when HYPERGEN_OVERWRITE is set", async () => {
		const CWD = "/tmp/overwrite-existing-file";
		fs.removeSync(CWD);
		const to = path.join(CWD, "app/hello.js");
		fs.ensureDirSync(path.dirname(to));
		fs.writeFileSync(to, "original content");

		const prev = process.env.HYPERGEN_OVERWRITE;
		process.env.HYPERGEN_OVERWRITE = "1";
		try {
			const result = await add(
				{
					attributes: { to: "app/hello.js" },
					body: "new content",
				},
				{},
				{
					logger,
					cwd: CWD,
				},
			);

			expect(result).toMatchSnapshot({ timing: expect.any(Number) });
			expect(fs.readFileSync(to).toString()).toBe("new content");
		} finally {
			if (prev === undefined) {
				process.env.HYPERGEN_OVERWRITE = undefined;
			} else {
				process.env.HYPERGEN_OVERWRITE = prev;
			}
			fs.removeSync(CWD);
		}
	});

	it("should skip existing file with force flag", async () => {
		const CWD = "/tmp/force-overwrite-file";
		fs.removeSync(CWD);
		const to = path.join(CWD, "app/hello.js");
		fs.ensureDirSync(path.dirname(to));
		fs.writeFileSync(to, "original content");

		const result = await add(
			{
				attributes: { to: "app/hello.js", force: true },
				body: "forced content",
			},
			{},
			{
				logger,
				cwd: CWD,
			},
		);

		expect(result.status).toBe("added");
		expect(fs.readFileSync(to).toString()).toBe("forced content");
		fs.removeSync(CWD);
	});
});
