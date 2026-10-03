// @hypercli/drive - Hyperdrive: spaces, warp, and machine sync for the hyper CLI
export { ConfigError, configExists, configPath, loadConfig } from "#config/index";
export { DEFAULT_CONFIG, DEFAULT_MACHINE, type DriveConfig } from "#config/schema";
export { type BaseArgs, BaseCommand, type BaseFlags } from "#lib/base-command";
export {
	claudeHome,
	encodeProjectDir,
	type LiveOptions,
	type LiveSession,
	lastAssistantText,
	latestTranscript,
	listTranscripts,
	liveSession,
	liveSessions,
	liveSessionsFor,
	type OwnerMarker,
	type OwnerState,
	ownerPath,
	projectDir,
	readOwner,
	type StopOutcome,
	stopSession,
	type TranscriptRef,
	transcriptLineCount,
	VERIFIED_CLAUDE_VERSION,
	writeOwner,
} from "#services/sessions";
export {
	detectSpace,
	findSpaceRoot,
	isSpace,
	libPath,
	repoSlugOf,
	type SpaceInfo,
	type SpaceLayout,
	spaceLayout,
	spaceRepos,
	worktreesDir,
} from "#services/space";
