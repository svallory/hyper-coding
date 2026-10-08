import { Flags } from "@oclif/core";
import { ConfigError } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { addHint, listMachines, type MachineInfo } from "#services/machine";

/** Render rows as a left-aligned table, like `hq status`. */
function renderTable(rows: MachineInfo[]): string[] {
	const headers = ["NAME", "HOST", "HOME", "FEATURES", "SOURCE"];
	const body = rows.map((row) => [
		row.name,
		row.host ?? "—",
		row.home ?? "—",
		row.features.join(", ") || "—",
		row.source,
	]);
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...body.map((cells) => cells[index].length)),
	);
	const line = (cells: string[]): string =>
		cells
			.map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index])))
			.join("  ");
	return [line(headers), ...body.map(line)];
}

export default class MachineList extends BaseCommand<typeof MachineList> {
	static override description = "List the machines hyperdrive knows about";

	static override examples = [
		"<%= config.bin %> machine list",
		"<%= config.bin %> machine list --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({ description: "Output JSON instead of a table", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(MachineList);

		let machines: MachineInfo[];
		try {
			machines = listMachines();
		} catch (err) {
			// Only a ConfigError is a user error. Anything else is a bug and keeps
			// its stack, matching `drive status`.
			if (!(err instanceof ConfigError)) throw err;
			const problem = new Error(err.message);
			problem.stack = flags.debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}

		if (flags.json) {
			this.log(JSON.stringify(machines, null, 2));
			return;
		}

		if (machines.length === 0) {
			this.log("No machines yet.");
			this.log(
				`Add one with \`${addHint("<name>")}\`, or run \`hyper drive setup\` to set up this one.`,
			);
			return;
		}

		for (const line of renderTable(machines)) this.log(line);
	}
}
