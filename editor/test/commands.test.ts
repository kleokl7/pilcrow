import {
  continueList, cycleHeading, deleteHiddenMarkBackward, indentItem, outdentItem, toggleBold, toggleBullet, toggleItalic, toggleNumbered, toggleTaskItem,
} from "../src/editor/commands";
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

test("the toolbar runs commands without taking focus from the editor", () => {
  const ed = createEditor({ parent: document.body, doc: "word", mode: "formatted", readOnly: false, onChange() {}, onOpenUrl() {} });
  const bar = createToolbar({ editor: ed });
  const labels = [...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Heading", "Bold", "Italic", "Checkbox", "Bullet list", "Numbered list", "Indent", "Outdent", "Undo", "Redo"]);
  const heading = bar.querySelector('button[aria-label="Heading"]')!;
  const down = new Event("pointerdown", { bubbles: true, cancelable: true });
  heading.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(ed.getText()).toBe("# word");
  bar.querySelector('button[aria-label="Undo"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
  expect(ed.getText()).toBe("word");
  ed.destroy();
});
