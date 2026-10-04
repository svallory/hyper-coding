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
	it("leaves another program completely alone: it need not understand -o", () => {
		for (const command of [
			"my-ssh-wrapper -i /tmp/key",
			"/usr/local/bin/company-ssh --batch",
			"rsync -e ssh",
		]) {
			expect(sshCommandWithBatchMode(command)).toBe(command);
		}
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
