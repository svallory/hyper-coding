import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { HqConfig } from "../config/schema.js";

export interface TelegramEnv {
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_STATE_DIR: string;
}

const TELEGRAM_STATE_ROOT = resolve(homedir(), ".config/hyper/hq-telegram-state");

export function getHqTelegramEnv(config: HqConfig): TelegramEnv | null {
	if (!config.telegram.hq_bot_token) return null;
	const stateDir = resolve(TELEGRAM_STATE_ROOT, "hq");
	mkdirSync(stateDir, { recursive: true });
	return {
		TELEGRAM_BOT_TOKEN: config.telegram.hq_bot_token,
		TELEGRAM_STATE_DIR: stateDir,
	};
}

export function getProjectTelegramEnv(projectName: string, config: HqConfig): TelegramEnv | null {
	const token = config.telegram.project_bots[projectName];
	if (!token) return null;

	const stateDir = resolve(TELEGRAM_STATE_ROOT, projectName);
	mkdirSync(stateDir, { recursive: true });
	return {
		TELEGRAM_BOT_TOKEN: token,
		TELEGRAM_STATE_DIR: stateDir,
	};
}
