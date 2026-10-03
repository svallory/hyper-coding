/**
 * The tool registry: everything `hyper machine setup --features tools` can put
 * on a machine, and how it is put there without root (C-6).
 *
 * Every recipe here runs through `ctx.runner.ssh` (C-16), so the same entry
 * installs on this Mac and over ssh, and a test can hand a recording runner to
 * the recipe and read back exactly which commands it would have run.
 *
 * Three rules hold for every entry, and the tests assert them:
 *
 * 1. **No root.** No root: nothing here calls a system package manager or
 *    escalates privilege. Tools go to `~/.local/bin`, to `~/.bun/bin`, or through
 *    mise; the only line we ever add to a user's shell rc file is a PATH export,
 *    and only when it isn't there (that line itself is its own task, `tools.path`).
 * 2. **Idempotent** (C-15). `detect` is asked first, and `install` writes through
 *    `install -m` / `ln -sf` / an installer that is itself idempotent. Running
 *    setup twice must not download anything the second time — the runner's
 *    `check` gate is what guarantees that, and `detect` is the only thing it
 *    trusts.
 * 3. **Version answers one shape.** Every tool has its own idea of what
 *    `--version` prints ("jq-1.8.2", "wt v0.73.0", "Mutagen version 0.18.1"),
 *    so {@link normaliseVersion} reduces them all to a bare `x.y.z` for the
 *    parity table.
 */

import type { RunResult } from "#services/remote";
import type { TaskContext } from "./tasks/types.js";

/** An expected installation failure, not a bug in a task. */
export class InstallError extends Error {
	override name = "InstallError";
}

/** One tool, and the only two things setup needs to know about it. */
export interface ToolSpec {
	/** Stable id, e.g. "rg". Also the task id suffix (`tools.rg`). */
	id: string;
	/** What the user would call it. */
	title: string;
	/** Anything the user should know before this runs (an installer that needs a terminal, …). */
	notes?: string;
	/** The installed version as a bare semver, or null when it isn't installed. */
	detect(ctx: TaskContext): Promise<string | null>;
	/** Put it there. Only called after `detect` said null (C-15). */
	install(ctx: TaskContext): Promise<void>;
}

/**
 * Refuse a platform we have no recipe for, by name.
 *
 * Handing a Linux binary to a machine that is neither Linux nor Darwin is worse
 * than an error: the download would 404 or, worse, unpack.
 */
function assertSupported(platform: Platform, tool: string, resolved: string | null): void {
	if (platform.os !== "Darwin" && platform.os !== "Linux") {
		throw new InstallError(
			`${tool} has no install recipe for ${platform.os} ${platform.arch}: this registry covers macOS and Linux only.`,
		);
	}
	if (resolved === null) {
		throw new InstallError(`${tool} publishes no release for ${platform.os} ${platform.arch}.`);
	}
}

/** Where a machine's tools go, and what the machine is. */
export interface Platform {
	/** `Darwin` or `Linux` — anything else has no recipe here. */
	os: string;
	/** `arm64` or `x86_64`, from `uname -m`, normalised. */
	arch: string;
}

/**
 * Where user-level tools put themselves, prepended to every command's PATH.
 *
 * `~/.local/bin` is the convention and the one thing we add to an rc file;
 * `~/.bun/bin` (bun's own installer), `~/.local/share/mise/shims` (mise) and
 * `~/.pi/agent/bin` (pi's own installer) are PATH entries those tools manage
 * themselves, and a non-login shell doesn't have them yet.
 */
const PRELUDE = `PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.bun/bin:$HOME/.pi/agent/bin:$PATH"; export PATH;`;

/** Run a script on the target and hand back the result, never throwing. */
async function sh(ctx: TaskContext, script: string): Promise<RunResult> {
	return ctx.runner.ssh(["sh", "-c", script]);
}

/**
 * Fetch a script and run it with the shell it is written for.
 *
 * Piping `curl … | sh` loses two things. A failed download still runs whatever
 * arrived, and the script gets whatever `sh` happens to be — which on Debian is
 * dash, where a bash script using `[[` or `set -o pipefail` dies immediately.
 * So: check `curl` is there, download to a file with a timeout, then run that
 * file with the tool's own shell. A missing shell is reported, not guessed at.
 */
function installerScript(url: string, shell: "sh" | "bash"): string {
	const run = shell === "bash" ? "bash" : "sh";
	return `set -eu
command -v curl >/dev/null 2>&1 || {
  echo "curl isn't installed, so I can't download ${url}." >&2
  echo "Install curl, then run this again." >&2
  exit 1
}
command -v ${run} >/dev/null 2>&1 || {
  echo "${run} isn't installed, and ${url} needs it." >&2
  exit 1
}
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT
curl -fsSL --max-time 300 ${JSON.stringify(url)} -o "$installer" || exit 1
[ -s "$installer" ] || { echo "the download from ${url} was empty." >&2; exit 1; }
${run} "$installer"
`;
}

/** Run a script that must succeed; a failure names the tool, not the shell. */
async function must(ctx: TaskContext, id: string, script: string): Promise<RunResult> {
	const result = await sh(ctx, script);
	if (result.code === 0) return result;
	const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
	throw new InstallError(`Installing ${id} failed: ${detail}`);
}

/**
 * Ask the machine a question and answer with its output, or null.
 *
 * Never throws and never sets `-e`: `detect` answering "not installed" is a
 * normal answer, and a check that threw would fail the whole run.
 */
async function ask(ctx: TaskContext, cmdline: string): Promise<string | null> {
	const result = await sh(ctx, `${PRELUDE}\n${cmdline}`);
	if (result.code !== 0) return null;
	const out = result.stdout.trim();
	return out === "" ? null : out;
}

/**
 * The first `x.y.z` in a tool's `--version` output.
 *
 * Deliberately the *first* dotted number, not the first number: "gh version
 * 2.97.0 (2026-07-31)" must parse as 2.97.0, and "Mutagen version 0.18.1" as
 * 0.18.1. Two components are enough (`jq` prints "jq-1.8", mise prints a date).
 */
export function normaliseVersion(raw: string | null): string | null {
	if (raw === null) return null;
	const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
	if (!match) return null;
	return match[3] === undefined ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${match[3]}`;
}

/** `<tool> --version`, parsed. Null when the tool isn't there. */
function versionOf(ctx: TaskContext, cmdline: string): Promise<string | null> {
	return ask(ctx, cmdline).then(normaliseVersion);
}

/**
 * What the machine is, per `uname -s` / `uname -m`.
 *
 * Read through the runner rather than from this process, because the machine
 * being set up is usually not this one.
 */
export async function detectPlatform(ctx: TaskContext): Promise<Platform> {
	const result = await sh(ctx, "uname -s; uname -m");
	const [rawOs = "", rawArch = ""] = result.stdout.trim().split("\n");
	const arch = rawArch.trim() === "aarch64" ? "arm64" : rawArch.trim();
	return { os: rawOs.trim(), arch };
}

/**
 * Download a release archive into `~/.local/bin`.
 *
 * Every user-level binary we ship (rtk, beads, worktrunk, mutagen) publishes a
 * per-platform archive on GitHub Releases, and every one of them is installed
 * the same way: resolve the latest tag, fetch that tag's asset for *this*
 * machine's OS and arch, unpack, install one file. The asset name is computed
 * here in TypeScript from {@link detectPlatform} so the choice is visible in the
 * source rather than hidden in shell, and the tag is resolved on the machine
 * being set up (one API call, no JSON parser needed — the tag is the first
 * `"tag_name"` line).
 */
async function installRelease(
	ctx: TaskContext,
	spec: {
		/** `owner/name` on GitHub. */
		repo: string;
		/** The asset for this machine, with `@TAG@` where the version goes. */
		asset: string;
		/** The binary inside the archive. */
		binary: string;
		/** Where it lands in `~/.local/bin`. Defaults to `binary`. */
		installAs?: string;
		/**
		 * Install into this directory instead of `~/.local/bin`, and link the
		 * binary from there. For a tool that loads data relative to its own path.
		 */
		directory?: string;
		/** Data files inside the platform archive, preserved beside the binary. */
		companions?: string[];
		/** Unpack command. `.tar.xz` needs `tar -xJf`, everything else `tar -xzf`. */
		unpack?: "tar -xzf" | "tar -xJf";
	},
): Promise<void> {
	const {
		repo,
		asset,
		binary,
		installAs = binary,
		unpack = "tar -xzf",
		directory = "$HOME/.local/bin",
		companions = [],
	} = spec;
	// `@TAG@`/`@TAGV@` are literal here on purpose: they are substituted by `sed`
	// on the machine, from the tag that machine resolved for itself. `@TAGV@` is
	// that tag without its leading `v`, which is how beads names its assets.
	await must(
		ctx,
		installAs,
		`set -eu
command -v curl >/dev/null 2>&1 || { echo "curl isn't installed, so I can't download the ${repo} release." >&2; exit 1; }
mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
# m7: a tag is substituted into a sed expression and a URL, so anything that
# is not a tag character is dropped rather than allowed to act as syntax.
# \`grep -m1\` closes the pipe as soon as it has the line, and curl reports that
# as "Failure writing output to destination" — a message about the tag, not about
# the tool, that reads like a failure in any output a user sees.
tag="$(curl -fsSL --max-time 300 https://api.github.com/repos/${repo}/releases/latest | grep -m1 '"tag_name"' | sed -e 's/.*"tag_name": *"//' -e 's/".*//' -e 's/[^A-Za-z0-9._-]//g' || true)"
[ -n "$tag" ] || { echo "couldn't work out the latest ${repo} release" >&2; exit 1; }
tagv="$(printf '%s' "$tag" | sed -e 's/^v//')"
asset="$(printf '%s' ${JSON.stringify(asset)} | sed -e "s/@TAGV@/$tagv/g" -e "s/@TAG@/$tag/g")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
unpack_one() {
  archive="$1"; want="$2"; into="$3"
  # Named after what is inside it, not after the file: the file is "$tmp/archive".
  dir="$tmp/unpacked-$want"
  mkdir -p "$dir"
  ${unpack} "$archive" -C "$dir"
  found="$dir/$want"
  [ -f "$found" ] || found="$(find "$dir" -type f -name "$want" | head -1)"
  [ -f "$found" ] || { echo "no $want in $(basename "$archive")" >&2; return 1; }
  mkdir -p "$into"
  install -m 0755 "$found" "$into/$want"
}
curl -fsSL --max-time 300 "https://github.com/${repo}/releases/download/$tag/$asset" -o "$tmp/archive"
unpack_one "$tmp/archive" ${JSON.stringify(binary)} "${directory}"
${companions.map((file) => `install -m 0644 "$dir/${file}" "${directory}/${file}"`).join("\n")}
if [ "${directory}/${binary}" != "$HOME/.local/bin/${installAs}" ]; then
  ln -sf "${directory}/${binary}" "$HOME/.local/bin/${installAs}"
fi`,
	);
}

/**
 * Is mise on this machine, and if not, its own installer.
 *
 * Five of the registry's tools come through mise, so it is a dependency of
 * theirs rather than a separate concern — installing one installs it.
 */
async function ensureMise(ctx: TaskContext): Promise<void> {
	if ((await ask(ctx, "command -v mise >/dev/null 2>&1 && echo yes")) !== null) return;
	await must(
		ctx,
		"mise",
		`mkdir -p "$HOME/.local/bin"
${installerScript("https://mise.run", "sh")}`,
	);
}

/**
 * A tool installed with `mise use -g <tool>@latest`.
 *
 * mise puts the binary in its own store rather than on PATH, so after installing
 * we ask `mise which` where it landed and link it into `~/.local/bin`. That
 * link is what makes the tool usable from a plain non-login shell, and it is
 * idempotent (`ln -sf`), so a second setup run doesn't fail on it.
 */
function miseTool(
	id: string,
	title: string,
	/** The name in the mise registry — not always the binary's name. */
	miseName: string,
	/** The command that prints its version, e.g. `rg --version`. */
	versionCmd: string,
	notes?: string,
): ToolSpec {
	// `mise which` is asked first, then `command -v`: on a machine where mise
	// shims are on PATH the plain command works and costs nothing, and on one
	// where they aren't, the store path does.
	// The binary is usually named after the tool id and not after the registry
	// name (`rg`, not `ripgrep`), so both are tried — mise reports "no executable
	// found" rather than a wrong answer when asked for the wrong one.
	// The shim, not the install path: `mise which` answers with the versioned
	// file (…/installs/ripgrep/15.2.0/rg), which stops being right the moment a
	// later version is installed. mise's own shims follow whatever is current.
	const which = `mise which ${id} 2>/dev/null || mise which ${miseName} 2>/dev/null`;
	const where = `command -v ${id} 2>/dev/null || (command -v mise >/dev/null 2>&1 && ${which})`;
	return {
		id,
		title,
		...(notes === undefined ? {} : { notes }),
		async detect(ctx) {
			return versionOf(
				ctx,
				`p="$(${where})" && [ -n "$p" ] && ${versionViaStore(versionCmd, id)} 2>/dev/null`,
			);
		},
		async install(ctx) {
			await ensureMise(ctx);
			await must(
				ctx,
				id,
				`set -eu
mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
mise use -g ${miseName}@latest
mise reshim
ln -sf "$HOME/.local/share/mise/shims/${id}" "$HOME/.local/bin/${id}"`,
			);
		},
	};
}

/**
 * Point a version command at the binary mise reported.
 *
 * It is matched on the *binary* name (the command's own first word), not on the
 * registry name: looking for `ripgrep` inside `rg --version` finds nothing, and
 * a detect that silently kept running `rg` from PATH meant the mise-only path
 * was never exercised at all.
 */
function versionViaStore(versionCmd: string, binary: string): string {
	return versionCmd.replace(new RegExp(`(^|\\s)${binary}\\b`), '$1"$p"');
}

/**
 * A tool with an official user-level install script.
 *
 * These installers put the binary in `~/.local/bin` (or `~/.bun/bin`) and are
 * idempotent themselves — re-running them updates rather than duplicating —
 * which is all C-15 needs of them.
 */
function scriptTool(
	id: string,
	title: string,
	url: string,
	versionCmd: string,
	/** The shell the script is written for. Checked by reading its shebang. */
	shell: "sh" | "bash",
	notes?: string,
): ToolSpec {
	return {
		id,
		title,
		...(notes === undefined ? {} : { notes }),
		detect: (ctx) => versionOf(ctx, versionCmd),
		async install(ctx) {
			await must(
				ctx,
				id,
				`mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
${installerScript(url, shell)}`,
			);
		},
	};
}

/**
 * The registry.
 *
 * Order is the order a user is offered the tools in: the two agents first, then
 * the CLIs the hooks call, then the general-purpose ones, then the tools the
 * others are built on (`mise`) and the sync engine (`mutagen`).
 */
export const TOOLS: readonly ToolSpec[] = [
	// claude.ai/install.sh is bash: it uses `[[` and `set -o pipefail`, which dash
	// (Debian's /bin/sh) rejects.
	scriptTool("claude", "Claude Code", "https://claude.ai/install.sh", "claude --version", "bash"),
	{
		id: "pi",
		title: "pi",
		notes:
			"The official installer draws a TUI and needs a terminal, so setup closes its stdin — which makes it abort. The npm fallback below is the headless path (same version); run the installer by hand if you want the managed install.",
		detect: (ctx) => versionOf(ctx, "pi --version"),
		async install(ctx) {
			// Installer first, per the vendor's own instructions. With stdin closed
			// it aborts rather than hanging (it needs a terminal), and we fall
			// through to npm. `--ignore-scripts` because pi's postinstall is what
			// wants a TTY; the prefix is the user's own, so no root is involved.
			await must(
				ctx,
				"pi",
				`mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
(
${installerScript("https://pi.dev/install.sh", "sh")}
) || {
  if command -v npm >/dev/null 2>&1; then
    NPM_CONFIG_PREFIX="$HOME/.local" npm install -g --ignore-scripts @earendil-works/pi-coding-agent || exit 1
  fi
}
command -v pi >/dev/null 2>&1 || {
  echo "pi is still missing. Run this yourself in a terminal: curl -fsSL https://pi.dev/install.sh | sh" >&2
  exit 1
}
`,
			);
		},
	},
	{
		id: "rtk",
		title: "rtk",
		detect: (ctx) => versionOf(ctx, "rtk --version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			// Rust target triples: the release assets are named after them, and the
			// Linux one differs by arch (see LINUX_ABI).
			const triple = rustTriple("rtk-ai/rtk", platform);
			assertSupported(platform, "rtk", triple);
			await installRelease(ctx, {
				repo: "rtk-ai/rtk",
				asset: `rtk-${triple}.tar.gz`,
				binary: "rtk",
			});
		},
	},
	{
		id: "bd",
		title: "bd (beads)",
		detect: (ctx) => versionOf(ctx, "bd --version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			const os = platform.os === "Darwin" ? "darwin" : "linux";
			assertSupported(platform, "bd", ["arm64", "x86_64"].includes(platform.arch) ? os : null);
			const arch = platform.arch === "arm64" ? "arm64" : "amd64";
			// beads' assets carry the version *without* the leading `v` the tag has.
			await installRelease(ctx, {
				repo: "steveyegge/beads",
				asset: `beads_@TAGV@_${os}_${arch}.tar.gz`,
				binary: "bd",
			});
		},
	},
	scriptTool("herdr", "herdr", "https://herdr.dev/install.sh", "herdr --version", "sh"),
	// The GitButler bootstrap declares `#!/bin/sh`.
	scriptTool(
		"but",
		"but (GitButler CLI)",
		"https://gitbutler.com/install.sh",
		"but --version",
		"sh",
	),
	{
		id: "wt",
		title: "wt (worktrunk)",
		detect: (ctx) => versionOf(ctx, "wt --version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			const triple = rustTriple("max-sixty/worktrunk", platform);
			assertSupported(platform, "wt", triple);
			await installRelease(ctx, {
				repo: "max-sixty/worktrunk",
				asset: `worktrunk-${triple}.tar.xz`,
				binary: "wt",
				unpack: "tar -xJf",
			});
		},
	},
	miseTool("gh", "gh (GitHub CLI)", "gh", "gh --version"),
	miseTool("jq", "jq", "jq", "jq --version"),
	miseTool("fzf", "fzf", "fzf", "fzf --version"),
	miseTool("rg", "rg (ripgrep)", "ripgrep", "rg --version"),
	miseTool("fd", "fd", "fd", "fd --version"),
	scriptTool("mise", "mise", "https://mise.run", "mise --version", "sh"),
	{
		id: "mutagen",
		title: "mutagen",
		detect: (ctx) => versionOf(ctx, "mutagen version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			const os = platform.os === "Darwin" ? "darwin" : "linux";
			const arch = platform.arch === "arm64" ? "arm64" : "amd64";
			assertSupported(platform, "mutagen", ["arm64", "x86_64"].includes(platform.arch) ? os : null);
			// The platform archive contains both the CLI and its agent bundle.
			// Preserve the bundle FILE beside the real binary; never unpack it.
			await installRelease(ctx, {
				repo: "mutagen-io/mutagen",
				asset: `mutagen_${os}_${arch}_@TAG@.tar.gz`,
				binary: "mutagen",
				installAs: "mutagen",
				directory: "$HOME/.local/libexec/mutagen",
				companions: ["mutagen-agents.tar.gz"],
			});
		},
	},
	// bun.sh/install is bash as well.
	scriptTool("bun", "bun", "https://bun.sh/install", "bun --version", "bash"),
];

/**
 * The Rust target triple for a platform, or null when we ship none.
 *
 * The Linux ABI is per tool *and* per arch, and there is no rule behind it: rtk
 * v0.51.0 publishes `aarch64-unknown-linux-gnu` and
 * `x86_64-unknown-linux-musl`, while worktrunk publishes musl for both. Guessing
 * "gnu unless told otherwise" gives a 404 on a Linux x86_64 server, which is
 * exactly the machine setup exists for.
 *
 * Each pair was read off `gh api repos/<repo>/releases/latest`; the pinned
 * asset names are asserted in machine-tools.test.ts so the table cannot rot
 * unnoticed.
 */
const LINUX_ABI: Record<string, Record<string, "gnu" | "musl">> = {
	// repo: { arm64, x86_64 } — rtk-ai/rtk v0.51.0
	"rtk-ai/rtk": { arm64: "gnu", x86_64: "musl" },
	// max-sixty/worktrunk v0.80.0
	"max-sixty/worktrunk": { arm64: "musl", x86_64: "musl" },
};

function rustTriple(repo: string, platform: Platform): string | null {
	if (platform.arch !== "arm64" && platform.arch !== "x86_64") return null;
	const arch = platform.arch === "arm64" ? "aarch64" : "x86_64";
	if (platform.os === "Darwin") return `${arch}-apple-darwin`;
	if (platform.os === "Linux") {
		const abi = LINUX_ABI[repo]?.[platform.arch];
		return abi === undefined ? null : `${arch}-unknown-linux-${abi}`;
	}
	return null;
}

/** The registry entry for an id, or undefined. */
export function findTool(id: string): ToolSpec | undefined {
	return TOOLS.find((tool) => tool.id === id);
}

/** Registry ids, in registry order. Unknown ids are dropped, not fatal. */
export function toolIds(ids?: readonly string[]): string[] {
	if (ids === undefined) return TOOLS.map((tool) => tool.id);
	const wanted = new Set(ids);
	return TOOLS.map((tool) => tool.id).filter((id) => wanted.has(id));
}
