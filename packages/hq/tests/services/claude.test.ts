import { describe, expect, it } from "vitest";
import type { ClaudeCommandOpts } from "#services/claude";
import { buildClaudeCommand } from "#services/claude";

describe("buildClaudeCommand", () => {
	const baseOpts: ClaudeCommandOpts = {
		name: "test-session",
	};

	describe("basic command structure", () => {
		it("generates a command with just a name", () => {
			const cmd = buildClaudeCommand(baseOpts);

			expect(cmd).toContain("unset CLAUDE_CODE_OAUTH_TOKEN;");
			expect(cmd).toContain("claude");
			expect(cmd).toContain("--name 'test-session'");
			expect(cmd).toContain("--allow-dangerously-skip-permissions");
		});

		it("unsets CLAUDE_CODE_OAUTH_TOKEN at the start", () => {
			const cmd = buildClaudeCommand(baseOpts);
			expect(cmd.startsWith("unset CLAUDE_CODE_OAUTH_TOKEN;")).toBe(true);
		});

		it("always includes --allow-dangerously-skip-permissions", () => {
			const cmd = buildClaudeCommand(baseOpts);
			expect(cmd).toContain("--allow-dangerously-skip-permissions");
		});

		it("places --allow-dangerously-skip-permissions right after claude", () => {
			const cmd = buildClaudeCommand(baseOpts);
			const parts = cmd.split(" ");
			const claudeIdx = parts.indexOf("claude");
			expect(parts[claudeIdx + 1]).toBe("--allow-dangerously-skip-permissions");
		});
	});

	describe("permissionMode", () => {
		it("adds --permission-mode flag when specified", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				permissionMode: "auto",
			});
			expect(cmd).toContain("--permission-mode auto");
		});

		it("does not include --permission-mode when not specified", () => {
			const cmd = buildClaudeCommand(baseOpts);
			expect(cmd).not.toContain("--permission-mode");
		});
	});

	describe("telegramBotToken", () => {
		it("sets TELEGRAM_BOT_TOKEN env var when provided", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				telegramBotToken: "123:ABC",
			});
			expect(cmd).toContain("TELEGRAM_BOT_TOKEN='123:ABC'");
		});

		it("does not set TELEGRAM_BOT_TOKEN when not provided", () => {
			const cmd = buildClaudeCommand(baseOpts);
			expect(cmd).not.toContain("TELEGRAM_BOT_TOKEN");
		});
	});

	describe("channels", () => {
		it("adds --channels flag with channel values", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				channels: ["plugin:telegram@claude-plugins-official"],
			});
			expect(cmd).toContain("--channels");
			expect(cmd).toContain("'plugin:telegram@claude-plugins-official'");
		});

		it("supports multiple channels", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				channels: ["channel-a", "channel-b"],
			});
			expect(cmd).toContain("--channels 'channel-a' 'channel-b'");
		});

		it("does not add --channels when array is empty", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				channels: [],
			});
			expect(cmd).not.toContain("--channels");
		});

		it("does not add --channels when not provided", () => {
			const cmd = buildClaudeCommand(baseOpts);
			expect(cmd).not.toContain("--channels");
		});
	});

	describe("extraArgs", () => {
		it("passes through extra arguments verbatim", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				extraArgs: ["--verbose", "--debug"],
			});
			expect(cmd).toContain("--verbose");
			expect(cmd).toContain("--debug");
		});

		it("does not add anything when extraArgs is empty", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				extraArgs: [],
			});
			// The command should just be the base command without extra stuff
			const parts = cmd.split(" ");
			const claudeIdx = parts.indexOf("claude");
			// After claude should come --allow-dangerously-skip-permissions
			expect(parts[claudeIdx + 1]).toBe("--allow-dangerously-skip-permissions");
		});
	});

	describe("resume", () => {
		it("adds --continue flag when resume is true", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				resume: true,
			});
			expect(cmd).toContain("--continue");
		});

		it("does not add --continue when resume is false", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				resume: false,
			});
			expect(cmd).not.toContain("--continue");
		});

		it("does not add --continue when resume is not specified", () => {
			const cmd = buildClaudeCommand(baseOpts);
			expect(cmd).not.toContain("--continue");
		});
	});

	describe("shell escaping", () => {
		it("escapes single quotes in name", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				name: "it's a test",
			});
			expect(cmd).toContain("--name 'it'\\''s a test'");
		});

		it("escapes single quotes in telegramBotToken", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				telegramBotToken: "token'with'quotes",
			});
			expect(cmd).toContain("TELEGRAM_BOT_TOKEN='token'\\''with'\\''quotes'");
		});

		it("handles spaces in name without additional escaping", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				name: "my session name",
			});
			expect(cmd).toContain("--name 'my session name'");
		});

		it("escapes single quotes in channel values", () => {
			const cmd = buildClaudeCommand({
				...baseOpts,
				channels: ["chan'nel"],
			});
			expect(cmd).toContain("'chan'\\''nel'");
		});
	});

	describe("full command composition", () => {
		it("builds a complete command with all options", () => {
			const cmd = buildClaudeCommand({
				name: "my-project",
				resume: true,
				permissionMode: "auto",
				telegramBotToken: "bot-token-123",
				channels: ["plugin:telegram@claude-plugins-official"],
				extraArgs: ["--verbose"],
			});

			// Verify order: unset, env var, claude, --allow-dangerously-skip-permissions, --continue, --name, --permission-mode, --channels, extra
			const unsetIdx = cmd.indexOf("unset CLAUDE_CODE_OAUTH_TOKEN;");
			const envIdx = cmd.indexOf("TELEGRAM_BOT_TOKEN=");
			const claudeIdx = cmd.indexOf(" claude ");
			const skipPermsIdx = cmd.indexOf("--allow-dangerously-skip-permissions");
			const continueIdx = cmd.indexOf("--continue");
			const nameIdx = cmd.indexOf("--name");
			const permIdx = cmd.indexOf("--permission-mode");
			const channelsIdx = cmd.indexOf("--channels");
			const verboseIdx = cmd.indexOf("--verbose");

			expect(unsetIdx).toBeLessThan(envIdx);
			expect(envIdx).toBeLessThan(claudeIdx);
			expect(claudeIdx).toBeLessThan(skipPermsIdx);
			expect(skipPermsIdx).toBeLessThan(continueIdx);
			expect(continueIdx).toBeLessThan(nameIdx);
			expect(nameIdx).toBeLessThan(permIdx);
			expect(permIdx).toBeLessThan(channelsIdx);
			expect(channelsIdx).toBeLessThan(verboseIdx);
		});
	});
});
