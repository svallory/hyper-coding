import type { IconId, Kind } from "./types";

export interface KindInfo {
	icon: IconId;
	/** The CSS custom property that colours this kind (defined in tokens.css). */
	token: string;
	label: string;
}

const kind = (key: Kind, icon: IconId, label: string): KindInfo => ({
	icon,
	token: `--kind-${key}`,
	label,
});

/** Every kind, once. Kinds that share an icon share its colour (see tokens.css). */
export const KINDS: Record<Kind, KindInfo> = {
	skill: kind("skill", "skill", "Skill"),
	command: kind("command", "skill", "Command"),
	agent: kind("agent", "agent", "Agent"),
	hook: kind("hook", "hook", "Hook"),
	reference: kind("reference", "file", "Reference"),
	playbook: kind("playbook", "file", "Playbook"),
	rule: kind("rule", "file", "Rule"),
	script: kind("script", "code", "Script"),
	"harness-code": kind("harness-code", "code", "Harness code"),
	binary: kind("binary", "code", "Binary"),
	tool: kind("tool", "code", "Tool"),
};
