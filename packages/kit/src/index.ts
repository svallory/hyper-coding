// @hypercli/kit - Kit lifecycle management for HyperDev
export const version = "0.0.0";

// Base Command
export {
	BaseCommand,
	type BaseFlags,
	type BaseArgs,
} from "#/base-command.js";

// Source resolution
export {
	resolveKitSource,
	buildInstallCommand,
	type KitSourceType,
	type ResolvedKitSource,
} from "#/source-resolver.js";
