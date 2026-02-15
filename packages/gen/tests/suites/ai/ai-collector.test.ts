import { describe, it, expect, beforeEach } from "vitest";
import { AiCollector, type AiBlockEntry } from "#/ai/ai-collector";

describe("AiCollector", () => {
	beforeEach(() => {
		AiCollector.reset();
	});

	describe("singleton", () => {
		it("returns the same instance", () => {
			const a = AiCollector.getInstance();
			const b = AiCollector.getInstance();
			expect(a).toBe(b);
		});

		it("returns a fresh instance after reset", () => {
			const a = AiCollector.getInstance();
			a.collectMode = true;
			AiCollector.reset();
			const b = AiCollector.getInstance();
			expect(b.collectMode).toBe(false);
		});
	});

	describe("collectMode", () => {
		it("defaults to false", () => {
			expect(AiCollector.getInstance().collectMode).toBe(false);
		});

		it("can be set to true", () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;
			expect(collector.collectMode).toBe(true);
		});

		it("resets to false on clear()", () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;
			collector.clear();
			expect(collector.collectMode).toBe(false);
		});
	});

	describe("addEntry / getEntries / hasEntries", () => {
		it("starts with no entries", () => {
			const collector = AiCollector.getInstance();
			expect(collector.hasEntries()).toBe(false);
			expect(collector.getEntries().size).toBe(0);
		});

		it("adds an entry", () => {
			const collector = AiCollector.getInstance();
			const entry: AiBlockEntry = {
				key: "mainFields",
				contexts: ["Model has id, name, email"],
				prompt: "Which fields for the card?",
				outputDescription: '["field1", "field2"]',
				sourceFile: "test.jig.t",
			};
			collector.addEntry(entry);

			expect(collector.hasEntries()).toBe(true);
			const entries = collector.getEntries();
			expect(entries.size).toBe(1);
			expect(entries.get("mainFields")).toEqual(entry);
		});

		it("overwrites duplicate keys", () => {
			const collector = AiCollector.getInstance();
			collector.addEntry({
				key: "dup",
				contexts: ["ctx1"],
				prompt: "first",
				outputDescription: "",
				sourceFile: "a.jig.t",
			});
			collector.addEntry({
				key: "dup",
				contexts: ["ctx2"],
				prompt: "second",
				outputDescription: "",
				sourceFile: "b.jig.t",
			});

			const entries = collector.getEntries();
			expect(entries.size).toBe(1);
			expect(entries.get("dup")!.prompt).toBe("second");
		});

		it("returns a copy from getEntries()", () => {
			const collector = AiCollector.getInstance();
			collector.addEntry({
				key: "k",
				contexts: [],
				prompt: "p",
				outputDescription: "",
				sourceFile: "f",
			});
			const entries = collector.getEntries();
			entries.delete("k");
			// Original should be unaffected
			expect(collector.hasEntries()).toBe(true);
		});
	});

	describe("addGlobalContext / getGlobalContexts", () => {
		it("starts with no global contexts", () => {
			expect(AiCollector.getInstance().getGlobalContexts()).toEqual([]);
		});

		it("adds global context", () => {
			const collector = AiCollector.getInstance();
			collector.addGlobalContext("TypeScript strict mode");
			collector.addGlobalContext("PostgreSQL database");

			const contexts = collector.getGlobalContexts();
			expect(contexts).toEqual(["TypeScript strict mode", "PostgreSQL database"]);
		});

		it("ignores empty/whitespace-only context", () => {
			const collector = AiCollector.getInstance();
			collector.addGlobalContext("");
			collector.addGlobalContext("   ");
			expect(collector.getGlobalContexts()).toEqual([]);
		});

		it("returns a copy from getGlobalContexts()", () => {
			const collector = AiCollector.getInstance();
			collector.addGlobalContext("ctx");
			const contexts = collector.getGlobalContexts();
			contexts.push("extra");
			expect(collector.getGlobalContexts()).toEqual(["ctx"]);
		});
	});

	describe("clear", () => {
		it("clears everything", () => {
			const collector = AiCollector.getInstance();
			collector.collectMode = true;
			collector.addGlobalContext("some context");
			collector.addEntry({
				key: "k",
				contexts: [],
				prompt: "p",
				outputDescription: "o",
				sourceFile: "f",
			});

			collector.clear();

			expect(collector.collectMode).toBe(false);
			expect(collector.hasEntries()).toBe(false);
			expect(collector.getGlobalContexts()).toEqual([]);
		});
	});
});
