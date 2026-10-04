import { describe, expect, it } from "vitest";
import { sshCommandWithBatchMode } from "#services/remote";

/**
 * The function lives in `services/remote.ts` because that is the only file
 * allowed to name an SSH program (C-16). These cases are pure string work —
 * which is why it can be tested here without spawning anything.
 */
describe("sshCommandWithBatchMode", () => {
	it.each([undefined, "", "   "])(
		"defaults to BatchMode when nothing is configured (%j)",
		(value) => {
			expect(sshCommandWithBatchMode(value)).toBe("ssh -o BatchMode=yes");
		},
	);
	it("inserts the option directly after the program, before the user's own", () => {
		// ssh honours the FIRST value of a repeated option, so appending would
		// leave a user's `-o BatchMode=no` in charge.
		expect(sshCommandWithBatchMode("ssh -o BatchMode=no")).toBe(
			"ssh -o BatchMode=yes -o BatchMode=no",
		);
	});
	it("keeps every other argument, in order", () => {
		expect(sshCommandWithBatchMode("ssh -i /tmp/key -p 2222 user@host")).toBe(
			"ssh -o BatchMode=yes -i /tmp/key -p 2222 user@host",
		);
	});
	it("recognises the program through a path", () => {
		expect(sshCommandWithBatchMode("/opt/homebrew/bin/ssh -i /tmp/key")).toBe(
			"/opt/homebrew/bin/ssh -o BatchMode=yes -i /tmp/key",
		);
	});
	it.each([
		// Leading environment assignments, the way a shell reads them.
		["FOO=1 ssh -i /k", "FOO=1 ssh -o BatchMode=yes -i /k"],
		["A=1 B=2 ssh", "A=1 B=2 ssh -o BatchMode=yes"],
		// A quoted program path, which a shell would run as one word. The quotes
		// stay exactly as written: git hands this string to a shell, and an
		// unquoted space would split the program path in two.
		['"/path with space/ssh" -i /k', '"/path with space/ssh" -o BatchMode=yes -i /k'],
		["'/opt/ssh' -i /k", "'/opt/ssh' -o BatchMode=yes -i /k"],
		['"/p/with \\"quote\\"/ssh" -i /k', '"/p/with \\"quote\\"/ssh" -o BatchMode=yes -i /k'],
		["/p/with\\ space/ssh -i /k", "/p/with\\ space/ssh -o BatchMode=yes -i /k"],
		// The program word is found by position, never by searching for "ssh":
		// an assignment whose VALUE is ssh is still an assignment.
		["X=ssh ssh -i /k", "X=ssh ssh -o BatchMode=yes -i /k"],
		['VAR="a b" ssh -i /k', 'VAR="a b" ssh -o BatchMode=yes -i /k'],
		["VAR='a b' C=\\ d ssh", "VAR='a b' C=\\ d ssh -o BatchMode=yes"],
		// `env` followed by assignments is read like assignments.
		["env FOO=1 ssh -i /k", "env FOO=1 ssh -o BatchMode=yes -i /k"],
		["/usr/bin/env FOO=1 BAR=2 ssh", "/usr/bin/env FOO=1 BAR=2 ssh -o BatchMode=yes"],
		["env ssh -p 22", "env ssh -o BatchMode=yes -p 22"],
		// Redirections after the program are the shell's business, not ours.
		["ssh -i /k 2>/dev/null", "ssh -o BatchMode=yes -i /k 2>/dev/null"],
		// A case-insensitive filesystem will happily run `SSH`.
		["SSH -i /k", "SSH -o BatchMode=yes -i /k"],
		["Ssh -o BatchMode=no", "Ssh -o BatchMode=yes -o BatchMode=no"],
	])("handles the common spelling %s", (command, expected) => {
		expect(sshCommandWithBatchMode(command)).toBe(expected);
	});
	it.each([
		// Skipped BY DESIGN: these are not the SSH client, and forcing an
		// option onto them would break a wrapper that never asked for one.
		"sshpass -p password-value ssh -i /k",
		"/opt/myssh -i /k",
		"company-ssh-wrapper",
		// Anything the scanner cannot read with confidence is left exactly as
		// the user wrote it, rather than guessed at.
		'"/opt/ssh -i /k',
		"'/opt/ssh -i /k",
		"ssh -i /k \\",
		"$(which ssh) -i /k",
		'"$(which ssh)" -i /k',
		"`which ssh` -i /k",
		"ssh -i /k | tee /tmp/log",
		"ssh -i /k; echo done",
		"ssh -i /k && true",
		"(ssh -i /k)",
		"ssh -i /k\nssh",
		// `env` options change what follows; not guessed at.
		"env -i ssh",
		"env -u FOO ssh",
		// Only assignments: there is no program word at all.
		"FOO=1",
		// A quoted NAME is not an assignment to a shell, so it is the program.
		'"A"=1 ssh',
	])("leaves %s alone", (command) => {
		expect(sshCommandWithBatchMode(command)).toBe(command);
	});
	it("keeps every byte of the command, its own spacing included", () => {
		// Only the inserted option is new; the user's own words pass through as
		// written, so a command they have already tested keeps behaving the same.
		expect(sshCommandWithBatchMode("  ssh  -i /tmp/key  ")).toBe(
			"  ssh -o BatchMode=yes  -i /tmp/key  ",
		);
		expect(sshCommandWithBatchMode("\tFOO=1\tssh\t-i /k")).toBe(
			"\tFOO=1\tssh -o BatchMode=yes\t-i /k",
		);
	});
	it("never invents an option for a bare program word", () => {
		expect(sshCommandWithBatchMode("ssh")).toBe("ssh -o BatchMode=yes");
	});
});
