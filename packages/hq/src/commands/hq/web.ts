import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configExists, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import * as tmux from "#services/tmux";
import { LOG_DIR } from "#utils/paths";

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape codes from tmux output
const BRIDGE_URL_RE = /https:\/\/claude\.ai\/code\?bridge=[^\s\x1b]*/g;

function extractBridgeUrl(text: string): string | null {
	const matches = text.match(BRIDGE_URL_RE);
	return matches && matches.length > 0 ? matches[matches.length - 1]! : null;
}

export default class Web extends BaseCommand<typeof Web> {
	static override description =
		"Open the HQ session in claude.ai/code (requires /remote-control to be active)";

	static override examples = ["<%= config.bin %> hq web"];

	async run(): Promise<void> {
		const sessionName = configExists() ? loadConfig().hq.name : "Hyper HQ";

		if (!tmux.sessionExists(sessionName)) {
			this.error(`HQ session '${sessionName}' is not running. Start it first with: hyper hq start`);
		}

		// Try to find the bridge URL from tmux pane content first
		let bridgeUrl: string | null = null;
		const paneContent = tmux.capturePane(sessionName);
		if (paneContent) {
			bridgeUrl = extractBridgeUrl(paneContent);
		}

		// Fall back to log file
		if (!bridgeUrl) {
			try {
				const logFile = resolve(LOG_DIR, `${sessionName}.log`);
				const logContent = readFileSync(logFile, "utf-8");
				bridgeUrl = extractBridgeUrl(logContent);
			} catch {}
		}

		if (!bridgeUrl) {
			this.error(
				`No bridge URL found. Make sure /remote-control is active in the HQ session.\n` +
					`  Attach to check: hyper hq attach`,
			);
		}

		this.log(`Opening: ${bridgeUrl}`);
		execSync(`open '${bridgeUrl}'`);
	}
}
