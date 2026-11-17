import { describe, expect, it } from "vitest";
import { readSite, readSourceLinks } from "../../scripts/lib/read-site";

const ref = (path: string, lines: string, extra = "") =>
	`<a data-ref=skill data-source=s data-path=${path} data-lines=${lines} ${extra} href=x>${path}</a>`;

// One lane, two steps, one connector with a citation, one choice group.
const HTML = `
<section id=l data-lane>
  <a data-step=a href="#l/a">A</a>
  <a data-connector="a~b" data-manual href="#l/a~b">c</a>
</section>
<section id="l/a" data-panel=step>
  <aside data-warning>w</aside>
  <ul class=tree>
    <li><details open data-row data-depth=0 data-kind=skill>
      <summary><span class=row-line>
        <span class=row-at>
          <a data-ref=skill data-source=s data-path=p.md data-lines=3 data-slot href=x>:3</a>, <a data-ref=skill data-source=s data-path=p.md data-lines=9 data-slot href=x>:9</a>
        </span>
        <span data-row-name><span class=kind-icon><svg></svg></span> <span class=ref-name>top</span></span>
      </span></summary>
      <ul>
        <li class=tree-choice data-choice><ul>
          <li><div data-row data-depth=1 data-kind=file data-manual><span data-row-name>alt  one</span></div></li>
          <li><div data-row data-depth=1 data-kind=file><span data-row-name>alt two</span></div></li>
        </ul></li>
      </ul>
    </details></li>
  </ul>
  <p>${ref("q.md", "5")} ${ref("q.md", "7", "data-more")}</p>
</section>
<section id="l/b" data-panel=step></section>
<section id="l/a~b" data-panel=connector><header class=panel-head><span class=chip data-chip=manual>manual</span></header>
  <p>${ref("r.md", "1-2")}</p></section>
<section id="l/b~a" data-panel=connector><header class=panel-head></header></section>
`;

describe("readSite", () => {
	const inventory = readSite(HTML, "demo");

	it("counts steps, connectors and manual connectors, and lists each step and connector", () => {
		expect(inventory).toEqual({
			page: "demo",
			lanes: [
				{
					id: "l",
					steps: 2,
					connectors: 2,
					manualConnectors: 1,
					stepList: [
						{
							id: "a",
							warnings: 1,
							rows: ["0 top", "1 alt one", "1 alt two"],
							manualRows: 1,
							citations: 2,
						},
						{ id: "b", warnings: 0, rows: [], manualRows: 0, citations: 0 },
					],
					connectorList: [
						{ id: "a~b", citations: 1 },
						{ id: "b~a", citations: 0 },
					],
				},
			],
		});
	});
});

describe("readSourceLinks", () => {
	const links = readSourceLinks(HTML);

	it("merges a comma list of lines, slot or not, into one link", () => {
		expect(links.map((l) => `${l.panel} ${l.path}:${l.lines}`)).toEqual([
			"l/a p.md:3,9",
			"l/a q.md:5,7",
			"l/a~b r.md:1-2",
		]);
	});

	it("gives a slot link the word of its row's name link", () => {
		const withWord = readSourceLinks(
			`<div id=l data-lane><div data-row data-depth=0><span class=row-line><span><a data-ref=skill data-source=s data-path=p.md data-lines=3 data-slot>:3</a></span><span data-row-name><a data-ref=skill data-source=s data-path=p.md data-word=Foo>Foo</a></span></span></div></div>`,
		);
		expect(withWord.map((l) => [l.lines, l.word])).toEqual([
			["3", "Foo"],
			[undefined, "Foo"],
		]);
	});
});
