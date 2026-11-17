import type { IconId, Kind } from "./types";

export interface KindInfo {
	icon: IconId;
	/** The CSS custom property that colours this kind (defined in tokens.css). */
	token: string;
	label: string;
}

const kind = (icon: IconId, label: string): KindInfo => ({
	icon,
	token: `--kind-${label.toLowerCase().replace(/\s+/g, "-")}`,
	label,
});

/** Every kind, once. Kinds that share an icon share its colour (see tokens.css). */
export const KINDS: Record<Kind, KindInfo> = {
	skill: kind("skill", "Skill"),
	command: kind("skill", "Command"),
	agent: kind("agent", "Agent"),
	hook: kind("hook", "Hook"),
	reference: kind("file", "Reference"),
	playbook: kind("file", "Playbook"),
	rule: kind("file", "Rule"),
	script: kind("code", "Script"),
	"harness-code": kind("code", "Harness code"),
	binary: kind("code", "Binary"),
	tool: kind("code", "Tool"),
};
