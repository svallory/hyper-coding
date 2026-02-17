export interface CommandCompletion {
	id: string;
	summary: string;
	flags: Record<string, FlagCompletion>;
}

export interface FlagCompletion {
	name: string;
	type: "option" | "boolean";
	summary?: string;
	description?: string;
	char?: string;
	multiple?: boolean;
	options?: string[];
	hidden?: boolean;
}

export interface TopicCompletion {
	name: string;
	description: string;
}
