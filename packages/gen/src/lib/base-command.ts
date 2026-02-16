/**
 * Base command class for @hypercli/gen commands
 */

import { BaseCommand as KitBaseCommand } from "@hypercli/kit";
import type { Command, Interfaces } from "@oclif/core";
import { GeneratorDiscovery } from "#discovery/generator-discovery";
import { RecipeEngine } from "#recipe-engine/recipe-engine";

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
	(typeof BaseCommand)["baseFlags"] & T["flags"]
>;
export type BaseArgs<T extends typeof Command> = Interfaces.InferredArgs<T["args"]>;

/**
 * Abstract base command that all gen commands extend
 */
export abstract class BaseCommand<T extends typeof Command> extends KitBaseCommand<T> {
	static override baseFlags = {
		...KitBaseCommand.baseFlags,
	};

	protected declare flags: BaseFlags<T>;
	protected declare args: BaseArgs<T>;
	protected discovery!: GeneratorDiscovery;
	protected recipeEngine!: RecipeEngine;
	protected hypergenConfig: any = {}; // TODO: Add proper type
	protected consoleLogger: any; // TODO: Add proper type

	override async init(): Promise<void> {
		await super.init();
		this.discovery = new GeneratorDiscovery();
		this.recipeEngine = new RecipeEngine();
	}
}
