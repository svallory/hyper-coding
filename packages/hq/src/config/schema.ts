export interface HqSessionConfig {
	name: string;
	dir: string;
	spawn_mode: "same-dir" | "worktree" | "session";
	capacity: number;
}

export interface ClaudeConfig {
	permission_mode?: "default" | "acceptEdits" | "plan" | "bypassPermissions" | "auto";
}

export interface TelegramConfig {
	hq_bot_token?: string;
	project_bots: Record<string, string>;
}

export interface ProjectOverride {
	type?: "group";
}

export interface HqConfig {
	projects_root: string;
	hq: HqSessionConfig;
	claude: ClaudeConfig;
	telegram: TelegramConfig;
	projects: Record<string, ProjectOverride>;
}

export const DEFAULT_CONFIG: HqConfig = {
	projects_root: "~/projects",
	hq: {
		name: "Hyper HQ",
		dir: "./hyper-hq",
		spawn_mode: "same-dir",
		capacity: 32,
	},
	claude: {
		permission_mode: "default",
	},
	telegram: {
		project_bots: {},
	},
	projects: {},
};
