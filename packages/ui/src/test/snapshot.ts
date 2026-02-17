/**
 * Snapshot Utilities
 *
 * Converts ANSI-styled output to a human-readable snapshot format
 * with readable tokens like [bold], [red], [/bold], [/red].
 */

/** Maps SGR enable codes to readable names */
const ATTR_NAMES: Record<number, string> = {
	1: "bold",
	2: "dim",
	3: "italic",
	4: "underline",
	7: "inverse",
	9: "strikethrough",
};

/** Maps SGR reset codes to what they close */
const ATTR_RESET_CODES: Record<number, string[]> = {
	22: ["bold", "dim"],
	23: ["italic"],
	24: ["underline"],
	27: ["inverse"],
	29: ["strikethrough"],
	39: ["fg"],
	49: ["bg"],
};

/** ANSI 16 foreground color code → name */
const FG_COLOR_NAMES: Record<number, string> = {
	30: "black",
	31: "red",
	32: "green",
	33: "yellow",
	34: "blue",
	35: "magenta",
	36: "cyan",
	37: "white",
	90: "brightBlack",
	91: "brightRed",
	92: "brightGreen",
	93: "brightYellow",
	94: "brightBlue",
	95: "brightMagenta",
	96: "brightCyan",
	97: "brightWhite",
};

/** ANSI 16 background color code → name */
const BG_COLOR_NAMES: Record<number, string> = {
	40: "black",
	41: "red",
	42: "green",
	43: "yellow",
	44: "blue",
	45: "magenta",
	46: "cyan",
	47: "white",
	100: "brightBlack",
	101: "brightRed",
	102: "brightGreen",
	103: "brightYellow",
	104: "brightBlue",
	105: "brightMagenta",
	106: "brightCyan",
	107: "brightWhite",
};

function toHex(n: number): string {
	return n.toString(16).padStart(2, "0");
}

/**
 * Process a list of SGR parameter codes and produce readable tokens.
 * Tracks open attributes for context-dependent resets (e.g. code 22 closes bold or dim).
 */
function processCodes(codes: number[], openAttrs: Set<string>): string[] {
	const tokens: string[] = [];
	let i = 0;

	while (i < codes.length) {
		const code = codes[i]!;

		// Full reset
		if (code === 0) {
			tokens.push("[reset]");
			openAttrs.clear();
			i++;
			continue;
		}

		// Style attributes (enable)
		if (ATTR_NAMES[code]) {
			const name = ATTR_NAMES[code]!;
			tokens.push(`[${name}]`);
			openAttrs.add(name);
			i++;
			continue;
		}

		// Style attribute resets
		if (ATTR_RESET_CODES[code]) {
			const candidates = ATTR_RESET_CODES[code]!;
			if (candidates.length === 1) {
				// Unambiguous reset
				const name = candidates[0]!;
				tokens.push(`[/${name}]`);
				openAttrs.delete(name);
			} else {
				// Ambiguous reset (e.g. 22 resets both bold and dim)
				// Close whichever is currently open; if both, close both
				const closed: string[] = [];
				for (const candidate of candidates) {
					if (openAttrs.has(candidate)) {
						closed.push(candidate);
						openAttrs.delete(candidate);
					}
				}
				if (closed.length === 0) {
					// Nothing open — emit the first candidate
					tokens.push(`[/${candidates[0]}]`);
				} else {
					for (const name of closed) {
						tokens.push(`[/${name}]`);
					}
				}
			}
			i++;
			continue;
		}

		// Foreground 16-color
		if (FG_COLOR_NAMES[code]) {
			tokens.push(`[${FG_COLOR_NAMES[code]}]`);
			openAttrs.add("fg");
			i++;
			continue;
		}

		// Background 16-color
		if (BG_COLOR_NAMES[code]) {
			tokens.push(`[bg:${BG_COLOR_NAMES[code]}]`);
			openAttrs.add("bg");
			i++;
			continue;
		}

		// Extended foreground: 38;5;N or 38;2;R;G;B
		if (code === 38) {
			const sub = codes[i + 1];
			if (sub === 5 && i + 2 < codes.length) {
				tokens.push(`[fg:${codes[i + 2]}]`);
				openAttrs.add("fg");
				i += 3;
				continue;
			}
			if (sub === 2 && i + 4 < codes.length) {
				const r = codes[i + 2]!;
				const g = codes[i + 3]!;
				const b = codes[i + 4]!;
				tokens.push(`[fg:#${toHex(r)}${toHex(g)}${toHex(b)}]`);
				openAttrs.add("fg");
				i += 5;
				continue;
			}
			i++;
			continue;
		}

		// Extended background: 48;5;N or 48;2;R;G;B
		if (code === 48) {
			const sub = codes[i + 1];
			if (sub === 5 && i + 2 < codes.length) {
				tokens.push(`[bg:${codes[i + 2]}]`);
				openAttrs.add("bg");
				i += 3;
				continue;
			}
			if (sub === 2 && i + 4 < codes.length) {
				const r = codes[i + 2]!;
				const g = codes[i + 3]!;
				const b = codes[i + 4]!;
				tokens.push(`[bg:#${toHex(r)}${toHex(g)}${toHex(b)}]`);
				openAttrs.add("bg");
				i += 5;
				continue;
			}
			i++;
			continue;
		}

		// Unknown code — skip
		i++;
	}

	return tokens;
}

/**
 * Converts styled output to a human-readable snapshot format.
 * Replaces ANSI SGR codes with readable tokens like `[bold]`, `[red]`, `[/bold]`, `[/red]`.
 * Strips volatile content (timestamps, durations) for deterministic snapshots.
 *
 * @param output - The raw ANSI-styled string to convert.
 * @returns A snapshot string with readable style tokens.
 */
export function snapshot(output: string): string {
	const openAttrs = new Set<string>();
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires control characters
	const SGR_REGEX = /\x1b\[([0-9;]*)m/g;

	let result = output.replace(SGR_REGEX, (_match, params: string) => {
		if (params === "") {
			// Empty params = reset
			const tokens = processCodes([0], openAttrs);
			return tokens.join("");
		}

		const codes = params.split(";").map((s: string) => Number.parseInt(s, 10));
		const tokens = processCodes(codes, openAttrs);
		return tokens.join("");
	});

	// Strip non-SGR ANSI sequences (cursor movement, etc.)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires control characters
	result = result.replace(/\x1b\[[0-9;]*[A-Za-ln-z]/g, "");

	// Strip volatile content for stable snapshots
	// Duration patterns: (1.2s), (123ms), (0.5s)
	result = result.replace(/\(\d+(?:\.\d+)?(?:ms|s)\)/g, "(TIME)");
	// ISO date patterns: 2024-01-15, 2025-12-31
	result = result.replace(/\d{4}-\d{2}-\d{2}/g, "(DATE)");

	return result;
}
