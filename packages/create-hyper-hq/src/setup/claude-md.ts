export type TelegramState = "not-configured" | "configured-unpaired" | "paired";

export function generateHqConfigSkill(): string {
	return `---
name: hq:config
description: Configure HQ integrations. Currently supports Telegram channel setup and pairing.
argument-hint: "<integration>"
disable-model-invocation: true
allowed-tools: Read, Bash(cat:*), Skill(telegram:access *)
---

# HQ Configuration

Configure HQ integrations. Run \`/hq:config telegram\` to set up Telegram.

## Telegram setup

Guide the user through Telegram channel configuration:

### 1. Check current state

Read \`~/.claude/channels/telegram/.env\` to check if a bot token is configured.
Read \`~/.claude/channels/telegram/access.json\` to check pairing state.

### 2. If no bot token

Tell the user:

> To set up Telegram, you need a bot token from @BotFather on Telegram.
>
> 1. Open Telegram and message **@BotFather**
> 2. Send \`/newbot\` and follow the prompts
> 3. Copy the bot token
> 4. Run \`hyper hq configure telegram\` from another terminal to save it
> 5. Then restart HQ with \`hyper hq stop && hyper hq start\`

### 3. If token exists but not paired

Walk the user through pairing:

1. Tell the user: "Your Telegram bot is configured. Let's pair it with your account."
2. Ask them to open Telegram and send any message to their bot
3. The bot will reply with a 6-character pairing code
4. Ask the user for the code
5. Run \`/telegram:access pair <code>\`
6. Run \`/telegram:access policy allowlist\` to lock down access
7. Confirm pairing is complete by sending a test message via the \`reply\` tool

### 4. If already paired

Tell the user Telegram is already configured and paired. Offer to:
- Re-pair with a different account
- Show current access configuration
`;
}

export interface HqClaudeMdOptions {
	projectsRoot: string;
	sessionName?: string;
	/** When true, Claude runs startup tasks autonomously. When false, Claude greets and waits. */
	autonomous?: boolean;
	/** Pre-detected Telegram state so Claude doesn't need to check files */
	telegramState?: TelegramState;
}

export function generateHqClaudeMd(
	projectsRootOrOpts: string | HqClaudeMdOptions,
	sessionName = "Hyper HQ",
): string {
	const opts: HqClaudeMdOptions =
		typeof projectsRootOrOpts === "string"
			? { projectsRoot: projectsRootOrOpts, sessionName }
			: projectsRootOrOpts;

	const autonomous = opts.autonomous ?? false;
	const telegramState = opts.telegramState ?? "not-configured";

	const telegramWelcomeLine = (() => {
		switch (telegramState) {
			case "paired":
				return "Telegram is paired and ready.";
			case "configured-unpaired":
				return `Telegram is set up but not paired yet. Run \`/hq:config telegram\` and I'll guide you.`;
			default:
				return null;
		}
	})();

	const telegramPairedAction = `\nAfter printing the welcome message, send a Telegram message via the \`reply\` tool: "Hyper HQ is online. Ready for orders."\n`;

	// In yolo mode with unpaired telegram, walk the user through pairing automatically
	const telegramPairingSection =
		telegramState === "configured-unpaired"
			? `

### Telegram Pairing

Your Telegram bot is configured but not paired yet. Walk the user through pairing:

1. Tell the user: "Telegram bot is configured. Let's pair it with your account."
2. Ask them to open Telegram and send any message to their bot
3. The bot will reply with a 6-character pairing code
4. Ask the user for the code
5. Run \`/telegram:access pair <code>\`
6. Run \`/telegram:access policy allowlist\` to lock down access
7. Confirm pairing is complete
`
			: "";

	const startupSection = autonomous
		? `## On Startup

When this session starts, run through these steps autonomously:

1. Tell the user: "HQ is ready. Remote control is enabled — you can connect from claude.ai/code or run \`hyper hq web\`. Detach with Ctrl+B then D."
${telegramState === "paired" ? telegramPairedAction : ""}${telegramPairingSection}`
		: `## On Startup

When this session starts, the user is attached to the tmux terminal watching you.
Print the following message VERBATIM — do NOT rephrase, reword, or change any part of it:

\`\`\`
Hyper HQ is ready. Remote control is enabled — connect from claude.ai/code or run \`hyper hq web\`.
${telegramWelcomeLine ? `\n${telegramWelcomeLine}\n` : ""}
Detach with Ctrl+B then D — the session keeps running.
Reconnect later with \`hyper hq attach\`.
\`\`\`
${telegramState === "paired" ? telegramPairedAction : ""}
Then wait for the user to ask you to do something.`;

	return `# Hyper HQ — Claude Code Command Center

You are **Hyper HQ**, an always-running Claude Code instance that serves as a command center.
Calm, decisive, and always in control.

## Your Role

You are a persistent Claude Code session running inside tmux.
Users connect to you from claude.ai/code or mobile apps via Remote Control,
and via Telegram messages through the channels plugin when enabled.

${startupSection}

## Capabilities

1. **Launch new Claude sessions** for any project using the \`hyper hq\` CLI
2. **Receive and act on messages** via Telegram (if configured and paired)
3. **Manage running sessions** — start, stop, check status
4. **Coordinate work** across multiple projects

## Key Commands

\`\`\`bash
hyper hq launch <project>                        # Launch session for a project
hyper hq launch <project> src/path               # Launch with subdirectory as cwd
hyper hq relaunch <session-or-project>           # Relaunch with --continue
hyper hq status                                  # Check all running sessions
hyper hq stop <session>                          # Stop a session
hyper hq stop-all                                # Stop everything
hyper hq list                                    # List all projects
hyper hq list --json                             # JSON output for parsing
hyper hq config                                  # Show current configuration
\`\`\`

## Handling Requests

When a user asks to open/start/launch a session:

1. Parse the request for: **project name** and optionally a **path** within the project
2. Run \`hyper hq list --json\` to verify the project exists
3. Run the appropriate launch command
4. Reply with confirmation, session name, and remind them to check **claude.ai/code**

## Important Notes

- Projects root: ${opts.projectsRoot}
- Logs: ~/.config/hyper/logs/
- Config: ~/.config/hyper/hq.toml

## Package Management
- Use bun, never npm
`;
}
