import { describe, expect, it } from "vitest";
import type { HqConfig } from "#config/schema";
import { DEFAULT_CONFIG } from "#config/schema";
import {
	getHqTelegramEnv,
	getProjectTelegramEnv,
	TELEGRAM_CHANNEL_PLUGIN,
} from "#services/telegram";

/** Helper to create a config with telegram overrides */
function makeConfig(telegram: Partial<HqConfig["telegram"]> = {}): HqConfig {
	return {
		...DEFAULT_CONFIG,
		telegram: {
			...DEFAULT_CONFIG.telegram,
			...telegram,
		},
	};
}

describe("TELEGRAM_CHANNEL_PLUGIN", () => {
	it("has the expected constant value", () => {
		expect(TELEGRAM_CHANNEL_PLUGIN).toBe("plugin:telegram@claude-plugins-official");
	});
});

describe("getHqTelegramEnv", () => {
	it("returns null when hq_bot_token is not set", () => {
		const config = makeConfig();
		expect(getHqTelegramEnv(config)).toBeNull();
	});

	it("returns null when hq_bot_token is undefined", () => {
		const config = makeConfig({ hq_bot_token: undefined });
		expect(getHqTelegramEnv(config)).toBeNull();
	});

	it("returns null when hq_bot_token is empty string", () => {
		const config = makeConfig({ hq_bot_token: "" });
		expect(getHqTelegramEnv(config)).toBeNull();
	});

	it("returns TelegramEnv with token when hq_bot_token is configured", () => {
		const config = makeConfig({ hq_bot_token: "123456:ABC-DEF" });
		const result = getHqTelegramEnv(config);

		expect(result).not.toBeNull();
		expect(result).toEqual({
			TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
		});
	});

	it("returns the exact token value without transformation", () => {
		const token = "9876543210:ABCdefGHIjklMNOpqrSTUvwxYZ";
		const config = makeConfig({ hq_bot_token: token });
		const result = getHqTelegramEnv(config);

		expect(result?.TELEGRAM_BOT_TOKEN).toBe(token);
	});
});

describe("getProjectTelegramEnv", () => {
	it("returns null when project has no bot configured", () => {
		const config = makeConfig({ project_bots: {} });
		expect(getProjectTelegramEnv("my-project", config)).toBeNull();
	});

	it("returns null for an unknown project name", () => {
		const config = makeConfig({
			project_bots: { "other-project": "token-other" },
		});
		expect(getProjectTelegramEnv("my-project", config)).toBeNull();
	});

	it("returns TelegramEnv when project bot is configured", () => {
		const config = makeConfig({
			project_bots: { "my-project": "bot-token-for-project" },
		});
		const result = getProjectTelegramEnv("my-project", config);

		expect(result).not.toBeNull();
		expect(result).toEqual({
			TELEGRAM_BOT_TOKEN: "bot-token-for-project",
		});
	});

	it("returns the correct token when multiple projects are configured", () => {
		const config = makeConfig({
			project_bots: {
				"project-a": "token-a",
				"project-b": "token-b",
				"project-c": "token-c",
			},
		});

		const resultA = getProjectTelegramEnv("project-a", config);
		const resultB = getProjectTelegramEnv("project-b", config);
		const resultC = getProjectTelegramEnv("project-c", config);

		expect(resultA?.TELEGRAM_BOT_TOKEN).toBe("token-a");
		expect(resultB?.TELEGRAM_BOT_TOKEN).toBe("token-b");
		expect(resultC?.TELEGRAM_BOT_TOKEN).toBe("token-c");
	});
});
