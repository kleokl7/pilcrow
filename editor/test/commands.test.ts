import {
  continueList, cycleHeading, deleteHiddenMarkBackward, indentItem, outdentItem, toggleBold, toggleBullet, toggleItalic, toggleNumbered, toggleTaskItem,
} from "../src/editor/commands";
import { runScopeHandlers } from "@codemirror/view";
import { createEditor } from "../src/editor/setup";
import { createToolbar } from "../src/ui/toolbar";
import { run } from "./helpers/run";

test("cycleHeading walks the levels", () => {
  expect(run(cycleHeading, "ti|tle")).toBe("# ti|tle");
  expect(run(cycleHeading, "# ti|tle")).toBe("## ti|tle");
  expect(run(cycleHeading, "## ti|tle")).toBe("### ti|tle");
  expect(run(cycleHeading, "### ti|tle")).toBe("ti|tle");
});

test("toggleBold wraps, unwraps and opens an empty pair", () => {
  expect(run(toggleBold, "a ⟦b⟧ c")).toBe("a **⟦b⟧** c");
  expect(run(toggleBold, "a **b|** c")).toBe("a b| c");
  expect(run(toggleBold, "a | c")).toBe("a **|** c");
});

test("toggleItalic wraps and unwraps with one asterisk", () => {
  expect(run(toggleItalic, "a ⟦b⟧ c")).toBe("a *⟦b⟧* c");
  expect(run(toggleItalic, "a *b|* c")).toBe("a b| c");
});

test("toggleTaskItem moves between paragraph, bullet and task", () => {
  expect(run(toggleTaskItem, "bu|y")).toBe("- [ ] bu|y");
  expect(run(toggleTaskItem, "- bu|y")).toBe("- [ ] bu|y");
  expect(run(toggleTaskItem, "- [x] bu|y")).toBe("- bu|y");
});

test("toggleBullet and toggleNumbered switch a paragraph to a list item and back", () => {
  expect(run(toggleBullet, "bu|y")).toBe("- bu|y");
  expect(run(toggleBullet, "- bu|y")).toBe("bu|y");
  expect(run(toggleNumbered, "bu|y")).toBe("1. bu|y");
  expect(run(toggleNumbered, "1. bu|y")).toBe("bu|y");
});

test("indent and outdent move list lines by two spaces", () => {
  expect(run(indentItem, "- a|")).toBe("  - a|");
  expect(run(outdentItem, "  - a|")).toBe("- a|");
  expect(run(outdentItem, "- a|")).toBe("- a|");
});

test("backspace at the start of a heading removes the hidden mark", () => {
  expect(run(deleteHiddenMarkBackward, "## |Title")).toBe("|Title");
  expect(run(deleteHiddenMarkBackward, "> |said")).toBe("|said");
  expect(run(deleteHiddenMarkBackward, "## Ti|tle")).toBe("## Ti|tle");
});

test("enter on an empty item ends the list", () => {
  expect(run(continueList, "- [ ] a\n- [ ] |")).toBe("- [ ] a\n|");
  expect(run(continueList, "- a\n- |")).toBe("- a\n|");
  expect(run(continueList, "1. a\n2. |")).toBe("1. a\n|");
});

test("enter inside an item starts a new one, unchecked for tasks", () => {
  expect(run(continueList, "- [x] a|")).toBe("- [x] a\n- [ ] |");
  expect(run(continueList, "- a|")).toBe("- a\n- |");
});

test("enter in a paragraph is a plain line break", () => {
  expect(run(continueList, "ab|c")).toBe("ab\n|c");
});

test("the toolbar acts on a tap, not on the start of a touch, and keeps the focus in the editor", () => {
  const ed = createEditor({ parent: document.body, doc: "word", mode: "formatted", readOnly: false, onChange() {}, onOpenUrl() {} });
  const bar = createToolbar({ editor: ed });
  const labels = [...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Heading", "Bold", "Italic", "Checkbox", "Bullet list", "Numbered list", "Indent", "Outdent", "Undo", "Redo"]);
  const heading = bar.querySelector('button[aria-label="Heading"]') as HTMLButtonElement;
  const down = new Event("pointerdown", { bubbles: true, cancelable: true });
  heading.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(ed.getText()).toBe("word"); // a swipe along the bar starts like this and must not format anything
  heading.click();
  expect(ed.getText()).toBe("# word");
  (bar.querySelector('button[aria-label="Undo"]') as HTMLButtonElement).click();
  expect(ed.getText()).toBe("word");
  ed.destroy();
});

function press(ed: ReturnType<typeof createEditor>, key: string) {
  return runScopeHandlers(ed.view, new KeyboardEvent("keydown", { key }), "editor");
}

test("the Enter key ends an empty item in the real editor", () => {
  const ed = createEditor({ parent: document.body, doc: "- [ ] a\n- [ ] ", mode: "formatted", readOnly: false, onChange() {}, onOpenUrl() {} });
  ed.view.dispatch({ selection: { anchor: ed.getText().length } });
  expect(press(ed, "Enter")).toBe(true);
  expect(ed.getText()).toBe("- [ ] a\n");
  ed.destroy();
});

test("the Backspace key removes a hidden heading mark in Formatted view and one character in Source view", () => {
  const formatted = createEditor({ parent: document.body, doc: "## Title", mode: "formatted", readOnly: false, onChange() {}, onOpenUrl() {} });
  formatted.view.dispatch({ selection: { anchor: 3 } });
  press(formatted, "Backspace");
  expect(formatted.getText()).toBe("Title");
  formatted.destroy();
  const source = createEditor({ parent: document.body, doc: "## Title", mode: "source", readOnly: false, onChange() {}, onOpenUrl() {} });
  source.view.dispatch({ selection: { anchor: 3 } });
  press(source, "Backspace");
  expect(source.getText()).toBe("##Title");
  source.destroy();
});
