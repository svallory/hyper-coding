import { homedir } from "node:os";
import { resolve } from "node:path";

export const HQ_DATA_DIR = resolve(homedir(), ".config/hyper");
export const LOG_DIR = resolve(HQ_DATA_DIR, "logs");
export const HQ_DIR = resolve(HQ_DATA_DIR, "hq");
export const SESSIONS_FILE = resolve(HQ_DIR, "sessions.json");

export function expandHome(p: string): string {
	if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
	return p;
}
