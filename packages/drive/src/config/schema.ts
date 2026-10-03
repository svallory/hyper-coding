import { homedir } from "node:os";

export type SyncCadence = "" | "manual" | "session-end" | "session-end+push";

export interface SelfConfig {
	/** This machine's name. */
	name: string;
	/** This machine's home dir (default: os.homedir()). */
	home: string;
}

export interface DefaultsConfig {
	/** When spaces sync to the hyperdrive: manual, on session end, or on session end plus push. */
	cadence: SyncCadence;
}

export interface MachineConfig {
	/** Home dir on that machine. */
	home: string;
	/** Features available on that machine. */
	features: string[];
	/** User agents run as on that machine. */
	agent_user: string;
}

export interface WarpConfig {
	/** Directory names excluded when warping a session between machines. */
	exclude: string[];
}

export interface SyncTargetConfig {
	/** Extra ignore patterns for this sync target. */
	ignore: string[];
}

export interface SyncConfig {
	claude: SyncTargetConfig;
	pi: SyncTargetConfig;
}

export interface DriveConfig {
	/** Git URL of the user's hyperdrive repo. */
	remote: string;
	self: SelfConfig;
	defaults: DefaultsConfig;
	machines: Record<string, MachineConfig>;
	warp: WarpConfig;
	sync: SyncConfig;
}

export const DEFAULT_CONFIG: DriveConfig = {
	remote: "",
	self: {
		name: "",
		home: homedir(),
	},
	defaults: {
		cadence: "",
	},
	machines: {},
	warp: {
		exclude: ["node_modules", "_build", "deps", "target", "dist", ".turbo", ".cache", ".next"],
	},
	sync: {
		claude: { ignore: [] },
		pi: { ignore: [] },
	},
};
