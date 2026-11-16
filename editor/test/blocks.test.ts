import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { blockField, blockPreview, countProperties, parseTable, renderInline } from "../src/editor/blocks";
import { markdownLanguage } from "../src/editor/setup";
import { describe_ } from "./helpers/decos";

function stateWith(doc: string, cursor: number) {
  return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdownLanguage(), blockPreview({ marks: "hide" })] });
}
const blockDecos = (doc: string, cursor: number) => describe_(stateWith(doc, cursor).field(blockField));
const textOf = (fragment: DocumentFragment) => {
  const div = document.createElement("div");
  div.append(fragment);
  return div.textContent;
};

test("parseTable reads header, alignment and rows", () => {
  expect(parseTable("| Post | Channel |\n| :-- | --: |\n| Launch thread | X |\n| a \\| b | |")).toEqual({
    header: ["Post", "Channel"],
    align: ["left", "right"],
    rows: [
      ["Launch thread", "X"],
      ["a | b", ""],
    ],
  });
});

test("parseTable pads short rows and reads centre and default alignment", () => {
  expect(parseTable("a | b | c\n:-: | --- | -\n1")).toEqual({ header: ["a", "b", "c"], align: ["center", null, null], rows: [["1", "", ""]] });
});

test("countProperties counts top-level keys only", () => {
  expect(countProperties("---\ntype: review\ntags:\n  - a\n  - b\nweek: 46\n---")).toBe(3);
});

test("table is replaced when the cursor is outside and shown when inside", () => {
  const doc = "x\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ny";
  expect(blockDecos(doc, 0)).toContain("block.table@3-32");
  expect(blockDecos(doc, 6)).toEqual([]);
});

test("frontmatter collapses to a properties widget", () => {
  expect(blockDecos("---\na: 1\n---\n\n# T", 14)).toContain("block.properties@0-12");
  expect(blockDecos("---\na: 1\n---\n\n# T", 5)).toEqual([]);
});

test("renderInline keeps unknown syntax verbatim", () => {
  expect(textOf(renderInline("**b** <x> [[A|c]]"))).toBe("b <x> c");
});

test("renderInline styles bold, italic, code and links", () => {
  const div = document.createElement("div");
  div.append(renderInline("**b** *i* `c` [t](https://e.com) [[W]]"));
  expect(div.querySelector("strong")!.textContent).toBe("b");
  expect(div.querySelector("em")!.textContent).toBe("i");
  expect(div.querySelector("code")!.textContent).toBe("c");
  expect(div.querySelector(".pc-link")!.textContent).toBe("t");
  expect(div.querySelector(".pc-wikilink")!.textContent).toBe("W");
});

test("the rendered table has the cells of the source and a tap reveals the source", () => {
  const doc = "x\n\n| Post | Status |\n| - | - |\n| **Launch** | Draft |\n\ny";
  const view = new EditorView({ parent: document.body, state: stateWith(doc, 0) });
  const table = view.dom.querySelector("table.pc-table")!;
  expect([...table.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["Post", "Status"]);
  expect([...table.querySelectorAll("td")].map((c) => c.textContent)).toEqual(["Launch", "Draft"]);
  table.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(view.state.selection.main.head).toBeGreaterThanOrEqual(3);
  expect(view.state.selection.main.head).toBeLessThan(doc.indexOf("\n\ny"));
  expect(view.dom.querySelector("table.pc-table")).toBeNull();
  view.destroy();
});

test("the properties widget counts and names its keys", () => {
  const view = new EditorView({ parent: document.body, state: stateWith("---\na: 1\nb: 2\n---\n\ntext", 20) });
  expect(view.dom.querySelector(".pc-props")!.textContent).toBe("2 properties");
  view.destroy();
  const one = new EditorView({ parent: document.body, state: stateWith("---\na: 1\n---\n\ntext", 15) });
  expect(one.dom.querySelector(".pc-props")!.textContent).toBe("1 property");
  one.destroy();
});
