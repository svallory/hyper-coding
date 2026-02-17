export interface CompletionEntry {
	name: string;
	description?: string;
}

export interface DynamicCache {
	builtAt: string;
	kits: CompletionEntry[];
	cookbooks: Record<string, CompletionEntry[]>;
	recipes: Record<string, CompletionEntry[]>;
	variables: Record<string, VariableCompletion[]>;
}

export interface VariableCompletion {
	name: string;
	type: string;
	description?: string;
	values?: string[];
	position?: number;
}

export type CompletionContext =
	| { level: "kit"; prefix: string }
	| { level: "cookbook"; kit: string; prefix: string }
	| { level: "recipe"; kit: string; cookbook: string; prefix: string }
	| {
			level: "variable";
			kit: string;
			cookbook: string;
			recipe: string;
			prefix: string;
			positionalIndex: number;
	  };
