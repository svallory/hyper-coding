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
		// A quoted program path, which a shell would run as one word.
		['"/path with space/ssh" -i /k', "/path with space/ssh -o BatchMode=yes -i /k"],
		["'/opt/ssh' -i /k", "/opt/ssh -o BatchMode=yes -i /k"],
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
	])("leaves %s alone", (command) => {
		expect(sshCommandWithBatchMode(command)).toBe(command);
	});
	it("trims the ends without rewriting the command's own spacing", () => {
		// Only the inserted option is new; the user's own words pass through as
		// written, so a command they have already tested keeps behaving the same.
		expect(sshCommandWithBatchMode("  ssh  -i /tmp/key  ")).toBe(
			"ssh -o BatchMode=yes  -i /tmp/key",
		);
	});
	it("never invents an option for a bare program word", () => {
		expect(sshCommandWithBatchMode("ssh")).toBe("ssh -o BatchMode=yes");
	});
});
