import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	findLatestSession,
	findSession,
	loadSessions,
	recordLaunch,
	recordStop,
} from "#services/sessions";

// Mock the file system
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

// Mock paths to control the sessions file location
vi.mock("#utils/paths", () => ({
	SESSIONS_FILE: "/tmp/test-sessions.json",
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

function makeSession(
	overrides: Partial<import("#services/sessions").SessionRecord> = {},
): import("#services/sessions").SessionRecord {
	return {
		sessionName: "hq-test-03-24-10-30",
		project: "test",
		projectDir: "/work/test",
		workDir: "/work/test",
		yolo: false,
		telegram: true,
		launchedAt: "2026-03-24T10:30:00.000Z",
		status: "running",
		...overrides,
	};
}

describe("sessions service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("loadSessions", () => {
		it("returns empty array when file does not exist", () => {
			mockExistsSync.mockReturnValue(false);
			expect(loadSessions()).toEqual([]);
		});

		it("returns parsed sessions when file exists", () => {
			const sessions = [makeSession()];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));
			expect(loadSessions()).toEqual(sessions);
		});

		it("returns empty array on parse error", () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("invalid json");
			expect(loadSessions()).toEqual([]);
		});
	});

	describe("recordLaunch", () => {
		it("adds new session to empty history", () => {
			mockExistsSync.mockReturnValue(false);
			const session = makeSession();
			recordLaunch(session);
			const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
			expect(written).toHaveLength(1);
			expect(written[0].sessionName).toBe("hq-test-03-24-10-30");
		});

		it("marks previous session with same name as stopped", () => {
			const existing = makeSession({ status: "running" });
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify([existing]));

			const newSession = makeSession({ launchedAt: "2026-03-24T11:00:00.000Z" });
			recordLaunch(newSession);

			const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
			expect(written).toHaveLength(2);
			expect(written[0].status).toBe("stopped");
			expect(written[0].stoppedAt).toBeDefined();
			expect(written[1].status).toBe("running");
		});
	});

	describe("recordStop", () => {
		it("marks running session as stopped", () => {
			const sessions = [makeSession({ status: "running" })];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));

			recordStop("hq-test-03-24-10-30");

			const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
			expect(written[0].status).toBe("stopped");
			expect(written[0].stoppedAt).toBeDefined();
		});

		it("does not modify already stopped sessions", () => {
			const sessions = [makeSession({ status: "stopped", stoppedAt: "2026-03-24T09:00:00.000Z" })];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));

			recordStop("hq-test-03-24-10-30");

			const written = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string);
			expect(written[0].stoppedAt).toBe("2026-03-24T09:00:00.000Z");
		});
	});

	describe("findSession", () => {
		it("finds session by exact name", () => {
			const sessions = [makeSession(), makeSession({ sessionName: "hq-other" })];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));

			const result = findSession("hq-other");
			expect(result?.sessionName).toBe("hq-other");
		});

		it("returns most recent when multiple matches", () => {
			const sessions = [
				makeSession({ launchedAt: "2026-03-24T08:00:00.000Z" }),
				makeSession({ launchedAt: "2026-03-24T10:00:00.000Z" }),
			];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));

			const result = findSession("hq-test-03-24-10-30");
			expect(result?.launchedAt).toBe("2026-03-24T10:00:00.000Z");
		});

		it("returns undefined when not found", () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify([]));

			expect(findSession("nonexistent")).toBeUndefined();
		});
	});

	describe("findLatestSession", () => {
		it("finds latest session by project name", () => {
			const sessions = [
				makeSession({ project: "foo", launchedAt: "2026-03-24T08:00:00.000Z" }),
				makeSession({ project: "foo", launchedAt: "2026-03-24T10:00:00.000Z" }),
				makeSession({ project: "bar" }),
			];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));

			const result = findLatestSession("foo");
			expect(result?.launchedAt).toBe("2026-03-24T10:00:00.000Z");
		});

		it("filters by path when provided", () => {
			const sessions = [
				makeSession({ project: "foo", path: "src/a" }),
				makeSession({ project: "foo", path: "src/b" }),
			];
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(sessions));

			const result = findLatestSession("foo", "src/a");
			expect(result?.path).toBe("src/a");
		});

		it("returns undefined when no match", () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify([]));

			expect(findLatestSession("nonexistent")).toBeUndefined();
		});
	});
});
