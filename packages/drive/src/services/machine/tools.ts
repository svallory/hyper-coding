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
 * 1. **No root.** Nothing names a system package manager or `sudo`. Tools go to
 *    `~/.local/bin`, to `~/.bun/bin`, or through mise; the only line we ever add
 *    to a user's shell rc file is a PATH export, and only when it isn't there.
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

/** Where a machine's tools go, and what the machine is. */
export interface Platform {
	/** `Darwin` or `Linux` — anything else has no recipe here. */
	os: string;
	/** `arm64` or `x86_64`, from `uname -m`, normalised. */
	arch: string;
}

/**
 * `export PATH="$HOME/.local/bin:$PATH"`, appended to a shell rc file only when
 * that exact line isn't in it already.
 *
 * Idempotent by grep, not by rewriting the file: a user's `.bashrc` is theirs,
 * and the only thing hyper adds is this line, at most once per file.
 */
export const PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

const PATH_RC = `
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -e "$rc" ] || touch "$rc"
  grep -qF '${PATH_LINE}' "$rc" || {
    printf '\\n# added by hyper machine setup: user-level tools live here\\n${PATH_LINE}\\n' >> "$rc"
  }
done
`;

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

/** Run a script that must succeed; a failure names the tool, not the shell. */
async function must(ctx: TaskContext, id: string, script: string): Promise<RunResult> {
	const result = await sh(ctx, script);
	if (result.code === 0) return result;
	const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
	throw new Error(`Installing ${id} failed: ${detail}`);
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
		/** Unpack command. `.tar.xz` needs `tar -xJf`, everything else `tar -xzf`. */
		unpack?: "tar -xzf" | "tar -xJf";
	},
): Promise<void> {
	const { repo, asset, binary, installAs = binary, unpack = "tar -xzf" } = spec;
	// `@TAG@`/`@TAGV@` are literal here on purpose: they are substituted by `sed`
	// on the machine, from the tag that machine resolved for itself. `@TAGV@` is
	// that tag without its leading `v`, which is how beads names its assets.
	await must(
		ctx,
		installAs,
		`set -eu
mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
tag="$(curl -fsSL https://api.github.com/repos/${repo}/releases/latest | grep -m1 '"tag_name"' | sed -e 's/.*"tag_name": *"//' -e 's/".*//')"
[ -n "$tag" ] || { echo "couldn't work out the latest ${repo} release" >&2; exit 1; }
tagv="$(printf '%s' "$tag" | sed -e 's/^v//')"
asset="$(printf '%s' ${JSON.stringify(asset)} | sed -e "s/@TAGV@/$tagv/g" -e "s/@TAG@/$tag/g")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://github.com/${repo}/releases/download/$tag/$asset" -o "$tmp/archive"
${unpack} "$tmp/archive" -C "$tmp"
src="$tmp/${binary}"
[ -f "$src" ] || src="$(find "$tmp" -type f -name ${JSON.stringify(binary)} | head -1)"
[ -f "$src" ] || { echo "no ${binary} in the ${repo} archive" >&2; exit 1; }
install -m 0755 "$src" "$HOME/.local/bin/${installAs}"
${PATH_RC}`,
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
		`set -eu
mkdir -p "$HOME/.local/bin"
curl -fsSL https://mise.run | sh
${PATH_RC}`,
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
	const which = `mise which ${id} 2>/dev/null || mise which ${miseName} 2>/dev/null`;
	const where = `command -v ${id} 2>/dev/null || (command -v mise >/dev/null 2>&1 && ${which})`;
	return {
		id,
		title,
		...(notes === undefined ? {} : { notes }),
		async detect(ctx) {
			return versionOf(
				ctx,
				`p="$(${where})" && [ -n "$p" ] && ${versionViaStore(versionCmd, miseName)} 2>/dev/null`,
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
p="$(${which})"
[ -n "$p" ] || { echo "mise installed ${miseName} but mise which can't find it" >&2; exit 1; }
ln -sf "$p" "$HOME/.local/bin/${id}"
${PATH_RC}`,
			);
		},
	};
}

/** `versionCmd.replace(miseName, '"$p"')` would also hit the words inside it. */
function versionViaStore(versionCmd: string, miseName: string): string {
	return versionCmd.replace(new RegExp(`\\b${miseName}\\b`), '"$p"');
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
				`set -eu
mkdir -p "$HOME/.local/bin"
curl -fsSL ${JSON.stringify(url)} | sh
${PATH_RC}`,
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
	scriptTool("claude", "Claude Code", "https://claude.ai/install.sh", "claude --version"),
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
				`set -eu
mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
curl -fsSL https://pi.dev/install.sh | sh || true
if ! command -v pi >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    NPM_CONFIG_PREFIX="$HOME/.local" npm install -g --ignore-scripts @earendil-works/pi-coding-agent || true
  fi
fi
command -v pi >/dev/null 2>&1 || {
  echo "pi is still missing. Run this yourself in a terminal: curl -fsSL https://pi.dev/install.sh | sh" >&2
  exit 1
}
${PATH_RC}`,
			);
		},
	},
	{
		id: "rtk",
		title: "rtk",
		detect: (ctx) => versionOf(ctx, "rtk --version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			// Rust target triples: the release assets are named after them.
			const triple = rustTriple(platform);
			if (triple === null)
				throw new Error(`rtk has no release for ${platform.os} ${platform.arch}`);
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
			if (platform.arch !== "arm64" && platform.arch !== "x86_64") {
				throw new Error(`bd has no release for ${platform.os} ${platform.arch}`);
			}
			const arch = platform.arch === "arm64" ? "arm64" : "amd64";
			// beads' assets carry the version *without* the leading `v` the tag has.
			await installRelease(ctx, {
				repo: "steveyegge/beads",
				asset: `beads_@TAGV@_${os}_${arch}.tar.gz`,
				binary: "bd",
			});
		},
	},
	scriptTool("herdr", "herdr", "https://herdr.dev/install.sh", "herdr --version"),
	scriptTool("but", "but (GitButler CLI)", "https://gitbutler.com/install.sh", "but --version"),
	{
		id: "wt",
		title: "wt (worktrunk)",
		detect: (ctx) => versionOf(ctx, "wt --version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			const triple = rustTriple(platform, "musl");
			if (triple === null) throw new Error(`wt has no release for ${platform.os} ${platform.arch}`);
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
	scriptTool("mise", "mise", "https://mise.run", "mise --version"),
	{
		id: "mutagen",
		title: "mutagen",
		detect: (ctx) => versionOf(ctx, "mutagen version"),
		async install(ctx) {
			const platform = await detectPlatform(ctx);
			const os = platform.os === "Darwin" ? "darwin" : "linux";
			const arch = platform.arch === "arm64" ? "arm64" : "amd64";
			if (platform.arch !== "arm64" && platform.arch !== "x86_64") {
				throw new Error(`mutagen has no release for ${platform.os} ${platform.arch}`);
			}
			await installRelease(ctx, {
				repo: "mutagen-io/mutagen",
				asset: `mutagen_${os}_${arch}_@TAG@.tar.gz`,
				binary: "mutagen",
			});
		},
	},
	scriptTool("bun", "bun", "https://bun.sh/install", "bun --version"),
];

/** The Rust target triple for a platform, or null when we ship none. */
function rustTriple(platform: Platform, linuxAbi = "gnu"): string | null {
	if (platform.arch !== "arm64" && platform.arch !== "x86_64") return null;
	const arch = platform.arch === "arm64" ? "aarch64" : "x86_64";
	if (platform.os === "Darwin") return `${arch}-apple-darwin`;
	if (platform.os === "Linux") return `${arch}-unknown-linux-${linuxAbi}`;
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
