/**
 * The parity table `hyper machine setup` prints when it finishes.
 *
 * The point is not a report — it is the answer to "why does the agent behave
 * differently here?". Every tool says what this machine has and what the other
 * one has, and the status says whether that difference matters:
 *
 * | status   | meaning                                                       |
 * |----------|---------------------------------------------------------------|
 * | `ok`     | both have it, same version                                    |
 * | `missing`| this machine has it, the other one doesn't                    |
 * | `older`  | the other machine has it, behind this one                     |
 * | `newer`  | the other machine has it, ahead of this one                    |
 * | `n/a`    | only the other machine has it — nothing to compare against    |
 * | `differs`| both have it, and the versions cannot be ordered              |
 *
 * `older` is the row that matters: it's the drift setup is supposed to have
 * prevented, and it's the one a user reads before concluding a hook broke.
 */

/** How a remote (or local) version compares with the other machine's. */
export type ParityStatus = "ok" | "missing" | "older" | "newer" | "n/a" | "differs";

export interface ParityRow {
	tool: string;
	local: string | null;
	remote: string | null;
	status: ParityStatus;
}

/**
 * A version as numbers, or null when it isn't dotted (`mise` prints a bare
 * year on some builds).
 *
 * Only the numeric core is compared: "2.97.0" and "gh version 2.97.0" are the
 * same tool version, and build metadata after the numbers isn't a difference
 * worth a row.
 */
function parts(version: string): [number, number, number, boolean] | null {
	const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-.*)?$/.exec(version.trim());
	if (!match) return null;
	// A pre-release is older than the release it precedes: 1.2.3-rc.1 ships
	// before 1.2.3, and treating it as equal would hide exactly the drift this
	// table exists to show.
	return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0), match[4] !== undefined];
}

/** -1, 0 or 1 — or null when either side isn't a version we can compare. */
export function compareVersions(a: string, b: string): number | null {
	const left = parts(a);
	const right = parts(b);
	if (left === null || right === null) return null;
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
	}
	if (left[3] === right[3]) return 0;
	// Same numbers: the one with the pre-release tag came first.
	return left[3] ? -1 : 1;
}

/**
 * One row per tool the registry knows, local and remote side by side.
 *
 * The tool list comes from whichever side has entries, sorted, so a tool that
 * only one machine has still gets a row — that asymmetry is the finding.
 */
export function parityTable(
	local: Record<string, string | null>,
	remote: Record<string, string | null>,
): ParityRow[] {
	const ids = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort();
	return ids.map((tool) => {
		const left = local[tool] ?? null;
		const right = remote[tool] ?? null;
		return { tool, local: left, remote: right, status: statusFor(left, right) };
	});
}

/** The status for one pair of versions. Split out so the tests can name a case. */
export function statusFor(local: string | null, remote: string | null): ParityStatus {
	// The other machine doesn't have it, so there is nothing to compare and the
	// gap is the whole answer.
	if (remote === null) return "missing";
	// Only the other machine has it: `missing` would claim the opposite.
	if (local === null) return "n/a";
	const order = compareVersions(local, remote);
	if (order === null) return local === remote ? "ok" : "differs";
	if (order === 0) return "ok";
	// order is local-vs-remote: local > remote means the remote one is behind.
	return order > 0 ? "older" : "newer";
}

/** The table, as lines. Aligned columns, because it is read by eye. */
export function renderParity(rows: readonly ParityRow[]): string[] {
	if (rows.length === 0) return [];
	const header = ["tool", "this machine", "other machine", "status"];
	const body = rows.map((row) => [row.tool, row.local ?? "-", row.remote ?? "-", row.status]);
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...body.map((cells) => cells[column].length)),
	);
	const line = (cells: string[]): string =>
		cells
			.map((cell, column) => cell.padEnd(widths[column]))
			.join("  ")
			.trimEnd();
	return [line(header), ...body.map(line)];
}
