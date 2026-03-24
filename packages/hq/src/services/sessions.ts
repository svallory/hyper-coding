import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SESSIONS_FILE } from "#utils/paths";

export interface SessionRecord {
	sessionName: string;
	project: string;
	path?: string;
	projectDir: string;
	workDir: string;
	permissionMode?: string;
	yolo: boolean;
	telegram: boolean;
	launchedAt: string;
	status: "running" | "stopped";
	stoppedAt?: string;
}

export function loadSessions(): SessionRecord[] {
	if (!existsSync(SESSIONS_FILE)) return [];
	try {
		return JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
	} catch {
		return [];
	}
}

function saveSessions(sessions: SessionRecord[]): void {
	const dir = dirname(SESSIONS_FILE);
	mkdirSync(dir, { recursive: true });
	writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf-8");
}

export function recordLaunch(record: SessionRecord): void {
	const sessions = loadSessions();
	// Mark any previous session with same name as stopped
	for (const s of sessions) {
		if (s.sessionName === record.sessionName && s.status === "running") {
			s.status = "stopped";
			s.stoppedAt = new Date().toISOString();
		}
	}
	sessions.push(record);
	saveSessions(sessions);
}

export function recordStop(sessionName: string): void {
	const sessions = loadSessions();
	for (const s of sessions) {
		if (s.sessionName === sessionName && s.status === "running") {
			s.status = "stopped";
			s.stoppedAt = new Date().toISOString();
		}
	}
	saveSessions(sessions);
}

export function findSession(sessionName: string): SessionRecord | undefined {
	const sessions = loadSessions();
	return [...sessions].reverse().find((s) => s.sessionName === sessionName);
}

export function findLatestSession(project: string, path?: string): SessionRecord | undefined {
	const sessions = loadSessions();
	return [...sessions]
		.reverse()
		.find((s) => s.project === project && (path === undefined || s.path === path));
}
