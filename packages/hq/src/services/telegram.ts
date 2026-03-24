import type { HqConfig } from "../config/schema.js";

export const TELEGRAM_CHANNEL_PLUGIN = "plugin:telegram@claude-plugins-official";

export interface TelegramEnv {
	TELEGRAM_BOT_TOKEN: string;
}

export function getHqTelegramEnv(config: HqConfig): TelegramEnv | null {
	if (!config.telegram.hq_bot_token) return null;
	return { TELEGRAM_BOT_TOKEN: config.telegram.hq_bot_token };
}

export function getProjectTelegramEnv(projectName: string, config: HqConfig): TelegramEnv | null {
	const token = config.telegram.project_bots[projectName];
	if (!token) return null;
	return { TELEGRAM_BOT_TOKEN: token };
}
