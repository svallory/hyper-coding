// @hypercli/kit - Kit lifecycle management for HyperDev
export const version = "0.0.0";

// Base Command
export {
	type BaseArgs,
	BaseCommand,
	type BaseFlags,
	type CookbookTree,
	type KitTree,
	type RecipeEntry,
} from "#base-command";

// Source resolution
export {
	buildInstallCommand,
	type KitSourceType,
	type ResolvedKitSource,
	resolveKitSource,
} from "#source-resolver";
