import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildDecorations, livePreview, previewPlugin, toggleTask } from "../src/editor/inline";
import { markdownLanguage } from "../src/editor/setup";
import { decos, describe_ } from "./helpers/decos";
import { stateOf } from "./helpers/tree";

function viewOf(doc: string, cursor = 0, extra: Parameters<typeof livePreview>[0] = { marks: "hide", onOpenUrl() {} }) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdownLanguage(), livePreview(extra)] }),
  });
}

test("heading mark is hidden and goes to the margin on the cursor line", () => {
  const d = decos("## Title\n\ntext", 5);
  expect(d).toContain("replace@0-3");
  expect(d).toContain("line.pc-h2.pc-active@0[data-mark=##]");
});

test("heading on another line has no margin mark", () => {
  const d = decos("## Title\n\ntext", 12);
  expect(d).toContain("replace@0-3");
  expect(d).toContain("line.pc-h2@0");
  expect(d.some((x) => x.includes("data-mark"))).toBe(false);
});

test("bold marks hide away from the cursor and show at the edge", () => {
  expect(decos("a **bold** z", 0)).toEqual(expect.arrayContaining(["replace@2-4", "replace@8-10", "mark.pc-strong@4-8"]));
  expect(decos("a **bold** z", 10).filter((x) => x.startsWith("replace"))).toEqual([]);
});

test("italic, strikethrough and inline code hide their marks", () => {
  expect(decos("x\n*i* ~~s~~ `c`", 0)).toEqual(
    expect.arrayContaining(["mark.pc-em@3-4", "mark.pc-strike@8-9", "mark.pc-code@13-14", "replace@2-3", "replace@6-8", "replace@12-13"]),
  );
});

test("a link shows its text and hides the address", () => {
  const d = decos("x\n[guide](https://example.com/s)", 0);
  expect(d).toEqual(expect.arrayContaining(["replace@2-3", "replace@8-32", "mark.pc-link@3-8"]));
});

test("wikilink alias hides target and brackets", () => {
  expect(decos("x\n[[A|b]]", 0)).toEqual(expect.arrayContaining(["replace@2-6", "replace@7-9", "mark.pc-wikilink@6-7"]));
});

test("wikilink without alias hides only the brackets", () => {
  expect(decos("x\n[[Ideas]]", 0)).toEqual(expect.arrayContaining(["replace@2-4", "replace@9-11", "mark.pc-wikilink@4-9"]));
});

test("task marker becomes a checkbox and done lines are marked", () => {
  const d = decos("- [x] done\n- [ ] todo\n\nz", 23);
  expect(d).toEqual(expect.arrayContaining(["widget.checkbox@2-5", "widget.checkbox@13-16", "line.pc-task-done@0"]));
});

test("a bullet mark becomes a bullet, and is shown raw under the cursor", () => {
  expect(decos("- item\n\nz", 8)).toContain("widget.bullet@0-1");
  expect(decos("- item\n\nz", 1).some((x) => x.startsWith("widget.bullet"))).toBe(false);
});

test("quote lines are styled and the mark goes to the margin", () => {
  expect(decos("> said\n\nz", 3)).toEqual(expect.arrayContaining(["replace@0-2", "line.pc-quote.pc-active@0[data-mark=>]"]));
});

test("a fenced code block hides its fences until the cursor enters", () => {
  const doc = "x\n\n```\ncode\n```\n";
  expect(decos(doc, 0)).toEqual(expect.arrayContaining(["replace@3-6", "replace@12-15", "line.pc-codeblock@7"]));
  expect(decos(doc, 8).filter((x) => x.startsWith("replace"))).toEqual([]);
});

test("a horizontal rule is drawn as a rule", () => {
  expect(decos("a\n\n---\n\nz", 0)).toContain("widget.rule@3-6");
});

test("dim mode replaces nothing but bullets and checkboxes", () => {
  const d = decos("## T\n\n**b** and - x", 0, "dim");
  expect(d.filter((x) => x.startsWith("replace"))).toEqual([]);
  expect(d).toContain("mark.pc-mark@0-2");
  expect(d.some((x) => x.includes("data-mark"))).toBe(false);
});

test("only visible ranges are decorated", () => {
  const big = "**a**\n".repeat(20000);
  const set = buildDecorations(stateOf(big), [{ from: 0, to: 60 }], { marks: "hide" });
  let max = 0;
  let count = 0;
  set.between(0, big.length, (_f, t) => {
    max = Math.max(max, t);
    count++;
  });
  expect(count).toBeGreaterThan(0);
  expect(max).toBeLessThanOrEqual(66);
});

test("toggleTask flips the marker text only", () => {
  const view = viewOf("- [ ] a");
  expect(toggleTask(view, 3)).toBe(true);
  expect(view.state.doc.toString()).toBe("- [x] a");
  toggleTask(view, 3);
  expect(view.state.doc.toString()).toBe("- [ ] a");
  view.destroy();
});

test("the plugin follows the cursor", () => {
  const view = viewOf("a **b** c", 0);
  expect(describe_(view.plugin(previewPlugin)!.decorations)).toContain("replace@2-4");
  view.dispatch({ selection: { anchor: 4 } });
  expect(describe_(view.plugin(previewPlugin)!.decorations)).not.toContain("replace@2-4");
  view.destroy();
});

test("composition freezes reveal", async () => {
  let composing = false;
  const view = viewOf("a **b** c", 0, { marks: "hide", onOpenUrl() {}, isComposing: () => composing });
  composing = true;
  view.dispatch({ selection: { anchor: 4 } });
  expect(describe_(view.plugin(previewPlugin)!.decorations)).toContain("replace@2-4");
  composing = false;
  view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  expect(describe_(view.plugin(previewPlugin)!.decorations)).not.toContain("replace@2-4");
  view.destroy();
});

test("a tap on a hidden link opens it and a tap on a checkbox toggles it", () => {
  const opened: string[] = [];
  const view = viewOf("x\n[guide](https://example.com/s)\n- [ ] a", 0, { marks: "hide", onOpenUrl: (u) => opened.push(u) });
  const link = view.contentDOM.querySelector(".pc-link") as HTMLElement;
  link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(opened).toEqual(["https://example.com/s"]);
  const box = view.contentDOM.querySelector(".pc-check") as HTMLElement;
  box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  expect(view.state.doc.toString()).toContain("- [x] a");
  view.destroy();
});

test("nothing is revealed and no line is active until the editor has focus", async () => {
  const { focusField, setFocused } = await import("../src/editor/reveal");
  const idle = EditorState.create({ doc: "## Title", selection: { anchor: 5 }, extensions: [markdownLanguage(), focusField] });
  const all = [{ from: 0, to: 8 }];
  expect(describe_(buildDecorations(idle, all, { marks: "hide" })).sort()).toEqual(["line.pc-h2@0", "replace@0-3"]);
  const focused = idle.update({ effects: setFocused.of(true) }).state;
  expect(describe_(buildDecorations(focused, all, { marks: "hide" }))).toContain("line.pc-h2.pc-active@0[data-mark=##]");
});
