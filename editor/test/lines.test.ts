import { setFocused } from "../src/editor/reveal";
import { createEditor } from "../src/editor/setup";

const base = { parent: document.body, readOnly: false, onChange() {}, onOpenUrl() {} };

/** The number each drawn line carries, in order. Lines drawn as a block (a table, the properties) have none. */
const numbers = (dom: HTMLElement) => [...dom.querySelectorAll(".cm-line")].map((line) => line.getAttribute("data-ln"));

test("with line numbers on, every line carries its number in the file", () => {
  const ed = createEditor({ ...base, doc: "one\ntwo\n\nfour", mode: "source", lineNumbers: true });
  expect(ed.view.dom.classList.contains("pc-lines")).toBe(true);
  expect(numbers(ed.view.dom)).toEqual(["1", "2", "3", "4"]);
  ed.destroy();
});

test("line numbers are off unless asked for", () => {
  const ed = createEditor({ ...base, doc: "one\ntwo", mode: "source" });
  expect(ed.view.dom.classList.contains("pc-lines")).toBe(false);
  expect(numbers(ed.view.dom)).toEqual([null, null]);
  ed.destroy();
});

test("numbers follow the text as lines are added", () => {
  const ed = createEditor({ ...base, doc: "one\ntwo", mode: "formatted", lineNumbers: true });
  ed.view.dispatch({ changes: { from: 0, insert: "zero\n" } });
  expect(numbers(ed.view.dom)).toEqual(["1", "2", "3"]);
  expect(ed.view.dom.querySelector(".cm-line[data-ln='3']")!.textContent).toBe("two");
  ed.destroy();
});

test("line numbers switch on and off without touching the text", () => {
  const ed = createEditor({ ...base, doc: "# a\nb", mode: "formatted" });
  ed.setLineNumbers(true);
  expect(ed.getLineNumbers()).toBe(true);
  expect(numbers(ed.view.dom)).toEqual(["1", "2"]);
  ed.setLineNumbers(false);
  expect(ed.view.dom.classList.contains("pc-lines")).toBe(false);
  expect(numbers(ed.view.dom)).toEqual([null, null]);
  expect(ed.getText()).toBe("# a\nb");
  ed.destroy();
});

test("line numbers survive a switch of view", () => {
  const ed = createEditor({ ...base, doc: "a\nb", mode: "formatted", lineNumbers: true });
  ed.setMode("source");
  expect(numbers(ed.view.dom)).toEqual(["1", "2"]);
  ed.destroy();
});

test("on the cursor line of a heading the margin keeps its mark; the number stays on the line", () => {
  const ed = createEditor({ ...base, doc: "## Title\nbody", mode: "formatted", lineNumbers: true });
  // jsdom has no real focus: say so the way the editor would.
  ed.view.dispatch({ selection: { anchor: 4 }, effects: setFocused.of(true) });
  const heading = ed.view.dom.querySelector(".cm-line[data-ln='1']")!;
  expect(heading.getAttribute("data-mark")).toBe("##");
  ed.destroy();
});
